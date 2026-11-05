import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const mainUrl = new URL("../../src/main.ts", import.meta.url);
function fixture(t: TestContext) {
    const directory = mkdtempSync(join(tmpdir(), "bb-json-bootstrap-"));
    t.after(() => {
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        rmSync(directory, { recursive: true, force: true });
    });
    const configPath =
        process.platform === "darwin"
            ? join(directory, "Library", "Application Support", "bb", "config.json")
            : join(directory, "bb", "config.json");
    const env = {
        ...process.env,
        APPDATA: directory,
        XDG_CONFIG_HOME: directory,
        HOME: directory,
        USERPROFILE: directory,
        BB_TOKEN: "private-bootstrap-marker",
    };
    const run = (args: string[], script?: string) => {
        const result = spawnSync(
            process.execPath,
            script
                ? ["--input-type=module", "--eval", script, fileURLToPath(mainUrl), ...args]
                : [fileURLToPath(mainUrl), ...args],
            {
                cwd: directory,
                env,
                encoding: "utf8",
                windowsHide: true,
                timeout: 15000,
            },
        );
        assert.ifError(result.error);
        assert.equal(result.stderr, "", result.stderr);
        assert.doesNotMatch(result.stdout, /private-bootstrap-marker|AssertionError/);
        const output = JSON.parse(result.stdout) as {
            schemaVersion: number;
            command: string | null;
            ok: boolean;
            exitCode: number;
            error: { code: string } | null;
            data: Record<string, unknown> | null;
        };
        assert.equal(output.schemaVersion, 1);
        assert.equal(output.exitCode, result.status);
        return output;
    };
    return { directory, configPath, run };
}

for (const args of [
    ["--json", "unknown-command"],
    ["--json", "get-pr-urls", "feature/test"],
    ["get-pr-url", "--json", "develop", "--repository"],
]) {
    test("executable JSON syntax errors contain no Commander text: " + args.join(" "), (t) => {
        const f = fixture(t);
        assert.equal(f.run(args).error?.code, "CLI_ARGUMENT_ERROR");
    });
}

test("JSON configuration errors preserve lazy credentials and final cleanup", (t) => {
    const f = fixture(t);
    const tokenUrl = new URL("../../src/auth/token-store.ts", import.meta.url);
    const script = `
        import assert from 'node:assert/strict';
        import { TokenStore } from ${JSON.stringify(tokenUrl.href)};
        let reads = 0; let cleanup = 0;
        TokenStore.prototype.get = () => { reads++; throw new Error('private-bootstrap-marker'); };
        TokenStore.prototype.clearCache = () => { cleanup++; };
        globalThis.fetch = () => { throw new Error('Unexpected network request'); };
        await import(${JSON.stringify(mainUrl.href)});
        assert.equal(reads, 0);
        assert.equal(cleanup, 1);
    `;
    const output = f.run(["--json", "get-pr-url", "feature/test", "develop"], script);
    assert.equal(output.error?.code, "APPLICATION_ERROR");
    assert.equal(output.data, null);
});

for (const fail of [false, true]) {
    test("doctor JSON bootstrap preserves diagnostic exit codes with failure=" + fail, (t) => {
        const f = fixture(t);
        mkdirSync(dirname(f.configPath), { recursive: true });
        writeFileSync(
            f.configPath,
            fail
                ? "{private-bootstrap-marker"
                : JSON.stringify({ bitbucket: { url: "https://example.invalid" } }),
        );
        const script = `
            import cp from 'node:child_process';
            import { syncBuiltinESMExports } from 'node:module';
            cp.spawnSync = (command) => ({ status:0, stdout:command === 'git' ? 'git version 2.50.0' : '12.2.1', stderr:'', signal:null });
            syncBuiltinESMExports();
            globalThis.fetch = () => { throw new Error('Unexpected network request'); };
            await import(${JSON.stringify(mainUrl.href)});
        `;
        const result = f.run(["doctor", "--json"], script);
        assert.equal(result.command, "doctor");
        assert.equal(result.ok, !fail);
        assert.equal(result.error?.code ?? null, fail ? "DIAGNOSTIC_FAILED" : null);
        assert.ok(Array.isArray(result.data?.checks));
    });
}

test("explicit help stays textual and lazy even with global --json", (t) => {
    const f = fixture(t);
    const result = spawnSync(
        process.execPath,
        [fileURLToPath(mainUrl), "--json", "merge-pr", "--help"],
        {
            cwd: f.directory,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            env: {
                ...process.env,
                APPDATA: f.directory,
                XDG_CONFIG_HOME: f.directory,
                HOME: f.directory,
                USERPROFILE: f.directory,
                BB_TOKEN: "",
            },
        },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: bb merge-pr/);
    assert.equal(result.stderr, "");
});
