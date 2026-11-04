import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createDoctorCliFixture } from "../helpers/doctor-fixture.ts";

test("doctor remote bootstrap uses only its configured URL and one read-only authenticated request", (t) => {
    const { directory, environment } = createDoctorCliFixture(
        t,
        JSON.stringify({ bitbucket: { url: "https://example.invalid/context" } }),
    );
    const mainUrl = new URL("../../src/main.ts", import.meta.url);
    const configUrl = new URL("../../src/config/config-store.ts", import.meta.url);
    const script = `
        import assert from 'node:assert/strict';
        import cp from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        import { ConfigStore } from ${JSON.stringify(configUrl.href)};
        ConfigStore.prototype.loadRequired = () => { throw new Error('Required config must remain lazy'); };
        let requests = 0;
        globalThis.fetch = async (url, init) => {
            requests++;
            assert.equal(url, 'https://example.invalid/context/rest/api/latest/dashboard/pull-requests?limit=1&start=0');
            assert.equal(init.method, 'GET');
            assert.equal(init.redirect, 'manual');
            assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-bootstrap-token');
            return Response.json({ size:0, limit:1, start:0, isLastPage:true, values:[] });
        };
        cp.spawnSync = (command) => ({ status:0, stdout: command === 'git' ? 'git version 2.50.0' : '12.2.1', stderr:'', signal:null });
        syncBuiltinESMExports();
        process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(mainUrl))}, 'doctor', '--remote'];
        await import(${JSON.stringify(mainUrl.href)});
        assert.equal(requests, 1);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
        cwd: directory,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
        env: { ...environment, BB_TOKEN: "private-bootstrap-token" },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /\[OK\] Remote authentication:/);
    assert.doesNotMatch(result.stdout, /private-bootstrap-token/);
});

for (const checkToken of [false, true]) {
    for (const content of [undefined, "{secret-marker", "{}"]) {
        test(`doctor bootstrap handles configuration ${JSON.stringify(content)} with check-token=${checkToken} without network or application config access`, (t) => {
            const { directory, configPath, environment } = createDoctorCliFixture(t, content);
            const entryPoint = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
            const tokenUrl = new URL("../../src/auth/token-store.ts", import.meta.url).href;
            const configUrl = new URL("../../src/config/config-store.ts", import.meta.url).href;
            const script = `
            import cp from 'node:child_process';
            import { syncBuiltinESMExports } from 'node:module';
            import { TokenStore } from ${JSON.stringify(tokenUrl)};
            import { ConfigStore } from ${JSON.stringify(configUrl)};
            const unexpected = () => { throw new Error('secret-marker'); };
            TokenStore.prototype.get = unexpected;
            if (!${checkToken}) TokenStore.prototype.inspectCredential = unexpected;
            ConfigStore.prototype.loadRequired = unexpected;
            globalThis.fetch = unexpected;
            cp.spawnSync = (command, args, options) => {
                if (command === 'git') {
                    if (JSON.stringify(args) !== '["--version"]') throw new Error('Unexpected Git operation');
                    if (options.timeout !== 10000) throw new Error('Missing Git timeout');
                    return { status: 0, stdout: 'git version 2.50.0', stderr: '', signal: null };
                }
                if (options.timeout !== 10000 || options.env.BB_TOKEN !== '') throw new Error('Unsafe npm invocation');
                return { status: 0, stdout: '12.2.1', stderr: '', signal: null };
            };
            syncBuiltinESMExports();
            process.argv = [process.execPath, ${JSON.stringify(entryPoint)}, 'doctor', ...${JSON.stringify(checkToken ? ["--check-token"] : [])}];
            await import(${JSON.stringify(new URL("../../src/main.ts", import.meta.url).href)});
        `;
            const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
                cwd: directory,
                encoding: "utf8",
                windowsHide: true,
                timeout: 15000,
                env: { ...environment, BB_TOKEN: "secret-marker" },
            });
            assert.ifError(result.error);
            assert.equal(result.status, content === "{secret-marker" ? 1 : 0, result.stderr);
            assert.equal(result.stderr, "");
            assert.match(result.stdout, /\[OK\] Node.js:/);
            assert.match(result.stdout, /\[OK\] npm: 12.2.1/);
            assert.match(result.stdout, /\[OK\] Git: git version 2.50.0/);
            assert.ok(result.stdout.includes(configPath));
            assert.doesNotMatch(result.stdout, /secret-marker/);
        });
    }
}
