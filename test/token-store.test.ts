import assert from "node:assert/strict";
import childProcess from "node:child_process";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { normalizeToken, TokenStore } from "../src/auth/token-store.ts";

function mockNative(t: TestContext, result: Partial<SpawnSyncReturns<string>> = {}) {
    const execute = t.mock.method(childProcess, "spawnSync", () => ({
        pid: 1, output: [], stdout: "test-token", stderr: "", status: 0, signal: null, ...result,
    }));
    syncBuiltinESMExports();
    t.after(() => { execute.mock.restore(); syncBuiltinESMExports(); });
    return execute;
}

function directory(t: TestContext) {
    const path = mkdtempSync(join(tmpdir(), "bb-token-test-"));
    t.after(() => rmSync(path, { recursive: true, force: true }));
    return path;
}

for (const platform of ["win32", "darwin", "linux", "aix"] as const) {
    test(`BB_TOKEN works on ${platform} without invoking native storage`, (t) => {
        const native = mockNative(t);
        const store = new TokenStore({ platform, environment: { BB_TOKEN: " environment-token " } });
        assert.equal(store.get(), "environment-token");
        assert.equal(store.source(), "BB_TOKEN");
        assert.equal(native.mock.callCount(), 0);
    });
}

test("stored credentials are cached per instance and clearCache forces a fresh read", (t) => {
    const native = mockNative(t);
    const store = new TokenStore({ platform: "linux", environment: {} });
    assert.equal(store.get(), "test-token");
    assert.equal(store.get(), "test-token");
    assert.equal(native.mock.callCount(), 1);
    store.clearCache();
    store.get();
    assert.equal(native.mock.callCount(), 2);
    new TokenStore({ platform: "linux", environment: {} }).get();
    assert.equal(native.mock.callCount(), 3);
});

test("an environment override takes priority even after a stored token has been cached", (t) => {
    const native = mockNative(t);
    const environment: NodeJS.ProcessEnv = {};
    const store = new TokenStore({ platform: "linux", environment });
    store.get();
    environment.BB_TOKEN = "new-override";
    assert.equal(store.get(), "new-override");
    assert.equal(native.mock.callCount(), 1);
    environment.BB_TOKEN = " ";
    assert.throws(() => store.get(), /cannot be empty/);
});

for (const [platform, status] of [["darwin", 44], ["linux", 1]] as const) {
    test(`missing credentials on ${platform} explain how to configure a token`, (t) => {
        mockNative(t, { status, stdout: "" });
        const store = new TokenStore({ platform, environment: {} });
        assert.equal(store.source(), undefined);
        assert.throws(() => store.get(), /bb token set.*BB_TOKEN/);
        assert.doesNotThrow(() => store.delete());
    });
}

test("Linux storage uses secret-tool stdin and never puts secrets in arguments or environment", (t) => {
    const native = mockNative(t);
    const store = new TokenStore({ platform: "linux", environment: { BB_TOKEN: "existing-environment-token" } });
    store.set("saved-token");
    const [command, args, options] = native.mock.calls[0].arguments;
    const spawnOptions = options as SpawnSyncOptions;
    assert.equal(command, "secret-tool");
    assert.deepEqual(args, ["store", "--label=bb Bitbucket token", "service", "bb.bitbucket", "account", "token"]);
    assert.equal(spawnOptions.input, "saved-token");
    assert.equal(spawnOptions.env?.BB_TOKEN, undefined);
    assert.equal(spawnOptions.shell, false);
    assert.equal(store.get(), "existing-environment-token");
});

test("macOS writes a single escaped command via stdin, preserving its failure status", (t) => {
    const native = mockNative(t);
    const token = 'quote"and\\backslash;$()';
    new TokenStore({ platform: "darwin", environment: {} }).set(token);
    const [command, args, options] = native.mock.calls[0].arguments;
    assert.equal(command, "/usr/bin/security");
    assert.deepEqual(args, ["-i"]);
    assert.equal((options as SpawnSyncOptions).input,
        'add-generic-password -U -s bb.bitbucket -a token -w "quote\\"and\\\\backslash;$()"\n');
});

test("Windows keeps the existing token.dat path and DPAPI format", (t) => {
    const path = directory(t);
    mkdirSync(join(path, "bb"));
    writeFileSync(join(path, "bb", "token.dat"), "encrypted-placeholder");
    const native = mockNative(t);
    const store = new TokenStore({ platform: "win32", environment: { APPDATA: path } });
    assert.equal(store.get(), "test-token");
    const [command, args, options] = native.mock.calls[0].arguments;
    assert.equal(command, "powershell.exe");
    assert.ok(args?.includes("-NonInteractive"));
    assert.ok(args?.some((arg) => arg.includes("ConvertTo-SecureString")));
    assert.equal((options as SpawnSyncOptions).env?.BB_TOKEN_PATH, join(path, "bb", "token.dat"));
    store.set("replacement-token");
    assert.equal((native.mock.calls[1].arguments[2] as SpawnSyncOptions).input, "replacement-token");
    assert.ok(!native.mock.calls[1].arguments[1]?.includes("replacement-token"));
    store.delete();
    assert.equal(existsSync(join(path, "bb", "token.dat")), false);
    assert.throws(() => store.get(), /not configured/);
});

for (const platform of ["darwin", "linux"] as const) {
    test(`native ${platform} errors are actionable and do not expose tool diagnostics`, (t) => {
        mockNative(t, { status: 1, stderr: "sensitive-secret-from-tool", stdout: "sensitive-secret-from-tool" });
        const store = new TokenStore({ platform, environment: {} });
        assert.throws(() => store.set("sensitive-secret-from-tool"), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /token operation failed/);
            assert.ok(!error.message.includes("sensitive-secret-from-tool"));
            assert.match(error.message, /BB_TOKEN/);
            return true;
        });
    });
}

test("a missing secret-tool executable reports the required dependency", (t) => {
    mockNative(t, { error: new Error("spawn ENOENT"), status: null });
    assert.throws(() => new TokenStore({ platform: "linux", environment: {} }).get(), /Install secret-tool/);
});

test("invalid and oversized tokens are rejected before persistence", (t) => {
    const native = mockNative(t);
    const store = new TokenStore({ platform: "linux", environment: {} });
    for (const token of ["", " ", "one\ntwo", "one\rtwo", "one\0two", "one\x85two", "one two", "x".repeat(1025)]) {
        assert.throws(() => store.set(token), /Bitbucket token/);
    }
    assert.equal(native.mock.callCount(), 0);
    assert.equal(normalizeToken("token\r\n"), "token");
});

test("setting and deleting credentials invalidate a previously cached token", (t) => {
    const native = mockNative(t);
    const store = new TokenStore({ platform: "linux", environment: {} });
    assert.equal(store.get(), "test-token");
    store.set("replacement-token");
    store.get();
    assert.equal(native.mock.callCount(), 3);
    store.delete();
    native.mock.mockImplementation(() => ({
        pid: 1, output: [], stdout: "", stderr: "", status: 1, signal: null,
    }));
    assert.throws(() => store.get(), /not configured/);
});

test("Windows DPAPI round trip uses isolated storage and never writes plaintext", {
    skip: process.platform !== "win32" || process.env.BB_TEST_NATIVE_TOKEN_STORE !== "1",
}, (t) => {
    const path = directory(t);
    const store = new TokenStore({ environment: { ...process.env, APPDATA: path, BB_TOKEN: undefined } });
    store.set("dpapi-test-token");
    assert.ok(!readFileSync(join(path, "bb", "token.dat"), "utf8").includes("dpapi-test-token"));
    assert.equal(store.get(), "dpapi-test-token");
    assert.equal(store.source(), "Windows DPAPI");
    store.delete();
    assert.equal(store.source(), undefined);
});
