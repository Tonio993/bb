import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

for (const mode of ["remote", "manual", "project", "missing-project"] as const) {
    test("repository bootstrap without a configured project: " + mode, (t) => {
        const directory = mkdtempSync(join(tmpdir(), "bb-repository-cli-"));
        t.after(() => {
            assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
            rmSync(directory, { recursive: true, force: true });
        });
        const configPath =
            process.platform === "darwin"
                ? join(directory, "Library", "Application Support", "bb", "config.json")
                : join(directory, "bb", "config.json");
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(
            configPath,
            JSON.stringify({
                bitbucket: {
                    url: "https://bitbucket.example/bitbucket",
                    sshHostnames: ["SSH-GATEWAY"],
                },
            }),
        );
        const command =
            mode === "project" || mode === "missing-project" ? "get-pr-urls" : "get-pr-url";
        const args = [command, "feature/test", "develop"];
        if (mode === "manual" || mode === "project") args.push("--project-key", "REMOTE");
        if (mode === "manual") args.push("--repository", "payments");
        const mainUrl = new URL("../../src/main.ts", import.meta.url);
        const configUrl = new URL("../../src/config/config-store.ts", import.meta.url);
        const script = `
            import assert from 'node:assert/strict';
            import cp from 'node:child_process';
            import { syncBuiltinESMExports } from 'node:module';
            import { ConfigStore } from ${JSON.stringify(configUrl.href)};
            let gitCalls = 0;
            let requests = 0;
            const remoteMode = ${mode === "remote"};
            if (!remoteMode) ConfigStore.prototype.get = () => { throw new Error('Git must remain lazy'); };
            cp.spawnSync = (command, args) => {
                assert.equal(remoteMode, true, 'Unexpected process');
                assert.equal(command, 'git');
                assert.deepEqual(args, ['remote', 'get-url', '--', 'origin']);
                gitCalls++;
                return { status:0, stdout:'git@ssh-gateway:REMOTE/payments.git', stderr:'', signal:null };
            };
            syncBuiltinESMExports();
            globalThis.fetch = async (input, init) => {
                assert.notEqual(${JSON.stringify(mode)}, 'missing-project');
                requests++;
                const expected = ${mode === "project"}
                    ? '/bitbucket/rest/api/latest/projects/REMOTE/repos'
                    : '/bitbucket/rest/api/latest/projects/REMOTE/repos/payments/pull-requests';
                assert.equal(new URL(input).pathname, expected);
                assert.equal(init.method, 'GET');
                assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer repository-test-token');
                return Response.json({ values:[], size:0, start:0, limit:100, isLastPage:true });
            };
            process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(mainUrl))}, ...${JSON.stringify(args)}];
            await import(${JSON.stringify(mainUrl.href)});
            assert.equal(gitCalls, remoteMode ? 1 : 0);
            assert.equal(requests, ${mode === "missing-project" ? 0 : 1});
        `;
        const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
            cwd: directory,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            env: {
                ...process.env,
                HOME: directory,
                USERPROFILE: directory,
                APPDATA: directory,
                XDG_CONFIG_HOME: directory,
                BB_TOKEN: "repository-test-token",
            },
        });
        assert.ifError(result.error);
        assert.equal(result.status, mode === "missing-project" ? 1 : 0, result.stderr);
        assert.equal(result.stdout, "");
        if (mode === "missing-project")
            assert.match(result.stderr, /Specify '--project-key <key>'/);
        else assert.equal(result.stderr, "");
        assert.doesNotMatch(result.stderr, /repository-test-token/);
    });
}
