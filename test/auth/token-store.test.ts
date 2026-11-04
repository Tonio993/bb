import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { TokenBackend } from "../../src/auth/token-backend.ts";
import { normalizeToken, TokenStore } from "../../src/auth/token-store.ts";

function fixture(t: TestContext, environment: NodeJS.ProcessEnv = {}) {
    let stored: string | undefined = "stored-token";
    const read = t.mock.fn(() => stored);
    const write = t.mock.fn((token: string) => {
        stored = token;
    });
    const remove = t.mock.fn(() => {
        stored = undefined;
    });
    const backend: TokenBackend = { name: "Test secure storage", read, write, delete: remove };
    return {
        store: new TokenStore(backend, environment),
        backend,
        environment,
        read,
        write,
        remove,
        setStored: (token: string | undefined) => {
            stored = token;
        },
    };
}

test("environment credentials bypass the backend for both reads and source inspection", (t) => {
    const { store, read } = fixture(t, { BB_TOKEN: " environment-token " });
    assert.equal(store.get(), "environment-token");
    assert.equal(store.inspectCredential(), "BB_TOKEN");
    assert.equal(read.mock.callCount(), 0);
});

test("stored credentials are cached per instance and clearCache forces a fresh read", (t) => {
    const { store, backend, read } = fixture(t);
    assert.equal(store.get(), "stored-token");
    assert.equal(store.get(), "stored-token");
    assert.equal(read.mock.callCount(), 1);
    store.clearCache();
    store.get();
    assert.equal(read.mock.callCount(), 2);
    new TokenStore(backend, {}).get();
    assert.equal(read.mock.callCount(), 3);
});

test("an environment override takes priority even after a stored token has been cached", (t) => {
    const { store, environment, read } = fixture(t);
    store.get();
    environment.BB_TOKEN = "new-override";
    assert.equal(store.get(), "new-override");
    assert.equal(store.inspectCredential(), "BB_TOKEN");
    environment.BB_TOKEN = " ";
    assert.throws(() => store.get(), /cannot be empty/);
    assert.throws(() => store.inspectCredential(), /cannot be empty/);
    assert.equal(read.mock.callCount(), 1);
});

test("an empty environment override never falls back to stored credentials", (t) => {
    const { store, read } = fixture(t, { BB_TOKEN: "" });
    assert.throws(() => store.get(), /cannot be empty/);
    assert.throws(() => store.inspectCredential(), /cannot be empty/);
    assert.equal(read.mock.callCount(), 0);
});

test("missing credentials explain how to configure a token", (t) => {
    const { store, setStored } = fixture(t);
    setStored(undefined);
    assert.equal(store.inspectCredential(), undefined);
    assert.throws(() => store.get(), /bb token set.*BB_TOKEN/);
});

test("source inspection validates storage without populating or replacing the read cache", (t) => {
    const { store, read, setStored } = fixture(t);
    assert.equal(store.get(), "stored-token");
    setStored("replacement-token");
    assert.equal(store.inspectCredential(), "Test secure storage");
    assert.equal(store.get(), "stored-token");
    assert.equal(read.mock.callCount(), 2);
    store.clearCache();
    assert.equal(store.get(), "replacement-token");
});

test("remote preflight can cache a validated source and reuse it without rereading storage", (t) => {
    const { store, read, setStored } = fixture(t);
    assert.equal(store.inspectCredential({ cacheForUse: true }), "Test secure storage");
    assert.equal(store.get(), "stored-token");
    assert.equal(store.inspectCredential({ cacheForUse: true }), "Test secure storage");
    assert.equal(read.mock.callCount(), 1);
    setStored("replacement-token");
    store.clearCache();
    assert.equal(store.get(), "replacement-token");
    assert.equal(read.mock.callCount(), 2);
});

test("setting and deleting credentials invalidate a previously cached token", (t) => {
    const { store, write, remove, read } = fixture(t);
    store.get();
    store.set(" replacement-token\r\n");
    assert.equal(store.get(), "replacement-token");
    assert.deepEqual(write.mock.calls[0].arguments, ["replacement-token"]);
    store.delete();
    assert.equal(remove.mock.callCount(), 1);
    assert.throws(() => store.get(), /not configured/);
    assert.equal(read.mock.callCount(), 3);
});

test("persistent updates do not modify the environment override", (t) => {
    const { store, environment, read } = fixture(t, { BB_TOKEN: "environment-token" });
    store.set("stored-replacement");
    store.delete();
    assert.equal(environment.BB_TOKEN, "environment-token");
    assert.equal(store.get(), "environment-token");
    assert.equal(read.mock.callCount(), 0);
});

test("invalid tokens are rejected before writing or clearing a valid cache", (t) => {
    const { store, write, read } = fixture(t);
    store.get();
    for (const token of [
        "",
        " ",
        "one\ntwo",
        "one\rtwo",
        "one\0two",
        "one\x85two",
        "one two",
        "x".repeat(1025),
    ]) {
        assert.throws(() => store.set(token), /Bitbucket token/);
    }
    assert.equal(store.get(), "stored-token");
    assert.equal(read.mock.callCount(), 1);
    assert.equal(write.mock.callCount(), 0);
    assert.equal(normalizeToken("token\r\n"), "token");
    assert.equal(normalizeToken("é".repeat(512)).length, 512);
    assert.throws(() => normalizeToken("é".repeat(513)), /1024 bytes/);
});

test("invalid backend credentials are validated and never cached", (t) => {
    const { store, setStored, read } = fixture(t);
    setStored("invalid token");
    assert.throws(() => store.get(), /whitespace/);
    assert.throws(() => store.inspectCredential(), /whitespace/);
    setStored("fixed-token");
    assert.equal(store.get(), "fixed-token");
    assert.equal(read.mock.callCount(), 3);
});

for (const operation of ["set", "delete"] as const) {
    test(`a failed ${operation} still invalidates the read cache`, (t) => {
        const { store, setStored, write, remove, read } = fixture(t);
        store.get();
        const fail = () => {
            throw new Error("Storage unavailable.");
        };
        if (operation === "set") write.mock.mockImplementation(fail);
        else remove.mock.mockImplementation(fail);
        assert.throws(
            () => (operation === "set" ? store.set("new-token") : store.delete()),
            /Storage unavailable/,
        );
        setStored("current-token");
        assert.equal(store.get(), "current-token");
        assert.equal(read.mock.callCount(), 2);
    });
}
