import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createTokenBackend } from "../../src/auth/token-backends.ts";
import type { TokenCommandRunner } from "../../src/auth/backends/token-command.ts";
import { TokenStore } from "../../src/auth/token-store.ts";

function directory(t: TestContext) {
    const path = mkdtempSync(join(tmpdir(), "bb-token-backend-test-"));
    t.after(() => {
        assert.equal(dirname(resolve(path)), resolve(tmpdir()));
        rmSync(path, { recursive: true, force: true });
    });
    return path;
}

function fixture(
    t: TestContext,
    platform: NodeJS.Platform,
    result: Partial<ReturnType<TokenCommandRunner>> = {},
) {
    const run: TokenCommandRunner = () => ({
        stdout: "test-token",
        stderr: "",
        status: 0,
        signal: null,
        ...result,
    });
    const execute = t.mock.fn(run);
    const homeDirectory = directory(t);
    const environment: NodeJS.ProcessEnv = {
        APPDATA: homeDirectory,
        BB_TOKEN: "environment-token",
    };
    const backend = createTokenBackend({ platform, environment, homeDirectory, execute });
    return { backend, execute, environment, homeDirectory };
}

for (const [platform, name] of [
    ["win32", "Windows DPAPI"],
    ["darwin", "macOS Keychain"],
    ["linux", "Linux Secret Service"],
] as const) {
    test(`selecting ${name} does not access storage or run a process`, (t) => {
        const { backend, execute, homeDirectory } = fixture(t, platform);
        assert.equal(backend.name, name);
        assert.equal(execute.mock.callCount(), 0);
        assert.equal(existsSync(join(homeDirectory, "bb")), false);
    });
}

for (const key of ["PSModulePath", "PSMODULEPATH", "psmodulepath"]) {
    test(`Windows PowerShell ignores inherited ${key} without changing the parent environment`, (t) => {
        const { backend, execute, environment, homeDirectory } = fixture(t, "win32");
        environment[key] = "incompatible-powershell-modules";
        environment.BB_NATIVE_TEST_SETTING = "preserved";
        const path = join(homeDirectory, "bb", "token.dat");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "encrypted-placeholder");

        backend.read();
        backend.write("saved-token");

        for (const {
            arguments: [, , options],
        } of execute.mock.calls) {
            assert.ok(
                !Object.keys(options.env ?? {}).some((key) => key.toUpperCase() === "PSMODULEPATH"),
            );
            assert.equal(options.env?.BB_NATIVE_TEST_SETTING, "preserved");
            assert.equal(options.env?.BB_TOKEN_PATH, path);
            assert.equal(options.env?.BB_TOKEN, undefined);
        }
        assert.equal(environment[key], "incompatible-powershell-modules");
    });
}

test("an unsupported platform still supports environment credentials without invoking storage", (t) => {
    const { backend, execute } = fixture(t, "aix");
    const store = new TokenStore(backend, { BB_TOKEN: "environment-token" });
    assert.equal(store.get(), "environment-token");
    assert.equal(store.inspectCredential(), "BB_TOKEN");
    for (const operation of [
        () => backend.name,
        () => backend.read(),
        () => backend.write("token"),
        () => backend.delete(),
    ]) {
        assert.throws(operation, /unavailable on this platform.*BB_TOKEN/);
    }
    assert.equal(execute.mock.callCount(), 0);
});

for (const [platform, status] of [
    ["darwin", 44],
    ["linux", 1],
] as const) {
    test(`missing credentials on ${platform} are distinct from failed writes`, (t) => {
        const { backend } = fixture(t, platform, { status, stdout: "" });
        assert.equal(backend.read(), undefined);
        assert.doesNotThrow(() => backend.delete());
        assert.throws(() => backend.write("token"), /token operation failed/);
    });
}

test("Linux storage passes the secret through stdin and isolates the current child environment", (t) => {
    const { backend, execute, environment } = fixture(t, "linux");
    environment.BB_NATIVE_TEST_SETTING = "updated";
    backend.write("saved-token");
    const [command, args, options] = execute.mock.calls[0].arguments;
    assert.equal(command, "secret-tool");
    assert.deepEqual(args, [
        "store",
        "--label=bb Bitbucket token",
        "service",
        "bb.bitbucket",
        "account",
        "token",
    ]);
    assert.equal(options.input, "saved-token");
    assert.equal(options.env?.BB_TOKEN, undefined);
    assert.equal(options.env?.BB_NATIVE_TEST_SETTING, "updated");
    assert.notEqual(options.env, environment);
    assert.equal(environment.BB_TOKEN, "environment-token");
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.encoding, "utf8");
    assert.equal(options.timeout, 60000);
    assert.equal(options.maxBuffer, 65536);
    assert.equal(backend.read(), "test-token");
    backend.delete();
    assert.deepEqual(execute.mock.calls[1].arguments[1], [
        "lookup",
        "service",
        "bb.bitbucket",
        "account",
        "token",
    ]);
    assert.deepEqual(execute.mock.calls[2].arguments[1], [
        "clear",
        "service",
        "bb.bitbucket",
        "account",
        "token",
    ]);
});

test("macOS writes one escaped command via stdin and preserves the native command failure status", (t) => {
    const { backend, execute } = fixture(t, "darwin");
    backend.write('quote"and\\backslash;$()');
    const [command, args, options] = execute.mock.calls[0].arguments;
    assert.equal(command, "/usr/bin/security");
    assert.deepEqual(args, ["-i"]);
    assert.equal(
        options.input,
        'add-generic-password -U -s bb.bitbucket -a token -w "quote\\"and\\\\backslash;$()"\n',
    );
    assert.equal(options.env?.BB_TOKEN, undefined);
    backend.read();
    backend.delete();
    assert.deepEqual(execute.mock.calls[1].arguments[1], [
        "find-generic-password",
        "-s",
        "bb.bitbucket",
        "-a",
        "token",
        "-w",
    ]);
    assert.deepEqual(execute.mock.calls[2].arguments[1], [
        "delete-generic-password",
        "-s",
        "bb.bitbucket",
        "-a",
        "token",
    ]);
});

test("Windows uses the existing token.dat path and keeps DPAPI scripts and secret input separate", (t) => {
    const { backend, execute, homeDirectory } = fixture(t, "win32");
    const path = join(homeDirectory, "bb", "token.dat");
    assert.equal(backend.read(), undefined);
    assert.equal(execute.mock.callCount(), 0);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "encrypted-placeholder");
    assert.equal(backend.read(), "test-token");
    const [command, args, options] = execute.mock.calls[0].arguments;
    assert.equal(command, "powershell.exe");
    assert.ok(args.includes("-NonInteractive"));
    assert.ok(args.some((arg) => arg.includes("ConvertTo-SecureString")));
    assert.equal(options.env?.BB_TOKEN_PATH, path);
    backend.write("replacement-token");
    assert.equal(execute.mock.calls[1].arguments[2].input, "replacement-token");
    assert.ok(!execute.mock.calls[1].arguments[1].includes("replacement-token"));
    backend.delete();
    assert.equal(existsSync(path), false);
    assert.equal(backend.read(), undefined);
});

test("Windows storage falls back to the supplied home directory when APPDATA is unavailable", (t) => {
    const homeDirectory = directory(t);
    const run: TokenCommandRunner = () => ({ status: 0, stdout: "", stderr: "", signal: null });
    const execute = t.mock.fn(run);
    createTokenBackend({ platform: "win32", homeDirectory, environment: {}, execute }).write(
        "test-token",
    );
    assert.equal(
        execute.mock.calls[0].arguments[2].env?.BB_TOKEN_PATH,
        join(homeDirectory, "AppData", "Roaming", "bb", "token.dat"),
    );
});

for (const platform of ["win32", "darwin", "linux"] as const) {
    for (const failure of ["status", "spawn", "signal", "throw"] as const) {
        test(`${platform} ${failure} failures never expose native diagnostics or the secret`, (t) => {
            const { backend, execute } = fixture(t, platform, {
                status: failure === "status" ? 1 : null,
                stdout: "private-secret",
                stderr: "private-secret",
                error: failure === "spawn" ? new Error("private-secret") : undefined,
                signal: failure === "signal" ? "SIGTERM" : null,
            });
            if (failure === "throw")
                execute.mock.mockImplementation(() => {
                    throw new Error("private-secret");
                });
            assert.throws(
                () => backend.write("private-secret"),
                (error: unknown) => {
                    assert.ok(error instanceof Error);
                    assert.match(error.message, /token operation failed.*BB_TOKEN/);
                    assert.ok(!error.message.includes("private-secret"));
                    return true;
                },
            );
        });
    }
}

test("a missing secret-tool executable reports the required dependency", (t) => {
    const { backend } = fixture(t, "linux", { error: new Error("spawn ENOENT"), status: null });
    assert.throws(() => backend.read(), /Install secret-tool/);
});

test("Linux lookup and clear failures with diagnostics are not treated as missing credentials", (t) => {
    const { backend } = fixture(t, "linux", { status: 1, stderr: "Session unavailable." });
    assert.throws(() => backend.read(), /token operation failed/);
    assert.throws(() => backend.delete(), /token operation failed/);
});

test(
    "Windows DPAPI round trip uses isolated storage and never writes plaintext",
    {
        skip: process.platform !== "win32" || process.env.BB_TEST_NATIVE_TOKEN_STORE !== "1",
    },
    (t) => {
        const path = directory(t);
        // Simulate a PowerShell 7 module shadowing the Windows PowerShell security module.
        const moduleRoot = join(path, "modules");
        const modulePath = join(moduleRoot, "Microsoft.PowerShell.Security");
        mkdirSync(modulePath, { recursive: true });
        writeFileSync(
            join(modulePath, "Microsoft.PowerShell.Security.psd1"),
            `@{
            RootModule = 'Microsoft.PowerShell.Security.psm1'
            ModuleVersion = '1.0.0'
            FunctionsToExport = @('ConvertTo-SecureString', 'ConvertFrom-SecureString')
        }`,
        );
        writeFileSync(
            join(modulePath, "Microsoft.PowerShell.Security.psm1"),
            'throw "Incompatible PowerShell module fixture."',
        );
        const environment = {
            ...process.env,
            APPDATA: path,
            BB_TOKEN: undefined,
            PSModulePath:
                moduleRoot + (process.env.PSModulePath ? `;${process.env.PSModulePath}` : ""),
        };
        const store = new TokenStore(createTokenBackend({ environment }), environment);
        store.set("dpapi-test-token");
        assert.ok(
            !readFileSync(join(path, "bb", "token.dat"), "utf8").includes("dpapi-test-token"),
        );
        assert.equal(store.get(), "dpapi-test-token");
        assert.equal(store.inspectCredential(), "Windows DPAPI");
        store.delete();
        assert.equal(store.inspectCredential(), undefined);
    },
);
