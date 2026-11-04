import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { runDoctor } from "../../../src/application/doctor/run-doctor.ts";
import { ConfigStore } from "../../../src/config/config-store.ts";
import { TokenStore } from "../../../src/auth/token-store.ts";
import { BitbucketClient } from "../../../src/bitbucket/bitbucket-client.ts";

function fixture(t: TestContext) {
    const directory = mkdtempSync(join(tmpdir(), "bb-remote-doctor-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const configStore = new ConfigStore(join(directory, "config.json"));
    writeFileSync(
        configStore.path,
        JSON.stringify({ bitbucket: { url: "https://example.invalid/context" } }),
    );
    const read = t.mock.fn<() => string | undefined>(() => "private-token");
    const forbidden = (): never => {
        throw new Error("Unexpected credential write.");
    };
    const environment: NodeJS.ProcessEnv = {};
    const tokenStore = new TokenStore(
        { name: "Test backend", tool: "test-tool", read, write: forbidden, delete: forbidden },
        environment,
    );
    const fetch = t.mock.fn(async () =>
        Response.json({ values: [], size: 0, limit: 1, start: 0, isLastPage: true }),
    );
    const createRemoteClient = t.mock.fn(
        (url: string) => new BitbucketClient(url, () => tokenStore.get(), { fetch }),
    );
    const toolAvailable = t.mock.fn(() => true);
    return {
        dependencies: {
            nodeVersion: "24.21.0",
            npmVersion: () => "12.2.1",
            gitVersion: () => "git version 2.50.0",
            configStore,
            tokenStore,
            toolAvailable,
            createRemoteClient,
        },
        read,
        fetch,
        createRemoteClient,
        environment,
        toolAvailable,
    };
}

test("default doctor does not create an HTTP client or read credentials", async (t) => {
    const { dependencies, read, createRemoteClient } = fixture(t);
    await runDoctor(dependencies);
    assert.equal(read.mock.callCount(), 0);
    assert.equal(createRemoteClient.mock.callCount(), 0);
});

test("remote checks reuse the validated configuration snapshot without reading individual keys", async (t) => {
    const { dependencies } = fixture(t);
    const snapshot = t.mock.method(dependencies.configStore, "snapshot");
    const get = t.mock.method(dependencies.configStore, "get", (): never => {
        throw new Error("The validated snapshot already contains the URL.");
    });
    const results = await runDoctor(dependencies, { remote: true });
    assert.equal(results.at(-1)!.status, "OK");
    assert.equal(snapshot.mock.callCount(), 1);
    assert.equal(get.mock.callCount(), 0);
});

test("an unrelated semantic configuration error preserves partial remote URL validation", async (t) => {
    const { dependencies, read, fetch } = fixture(t);
    writeFileSync(
        dependencies.configStore.path,
        JSON.stringify({
            bitbucket: { url: "https://example.invalid/context", projectKey: " " },
        }),
    );
    const results = await runDoctor(dependencies, { remote: true });
    assert.ok(results.some((check) => check.name === "Configuration" && check.status === "FAIL"));
    assert.equal(results.at(-1)!.status, "OK");
    assert.equal(read.mock.callCount(), 1);
    assert.equal(fetch.mock.callCount(), 1);
});

for (const checkToken of [false, true]) {
    test(`remote checks read credentials once with check-token=${checkToken} and work without project key`, async (t) => {
        const { dependencies, read, createRemoteClient, fetch } = fixture(t);
        const results = await runDoctor(dependencies, { remote: true, checkToken });
        assert.equal(read.mock.callCount(), 1);
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(createRemoteClient.mock.callCount(), 1);
        assert.deepEqual(createRemoteClient.mock.calls[0].arguments, [
            "https://example.invalid/context",
        ]);
        assert.equal(results.at(-1)!.status, "OK");
        assert.ok(
            results.some((check) => check.name === "Configuration" && check.status === "WARN"),
        );
        assert.doesNotMatch(JSON.stringify(results), /private-token/);
    });
}

for (const content of [
    "{}",
    "{private-config-value",
    '{"bitbucket":{"url":"private-config-value"}}',
]) {
    test(`invalid remote configuration avoids token reads and HTTP requests: ${content}`, async (t) => {
        const { dependencies, read, createRemoteClient } = fixture(t);
        writeFileSync(dependencies.configStore.path, content);
        const results = await runDoctor(dependencies, { remote: true });
        assert.equal(read.mock.callCount(), 0);
        assert.equal(createRemoteClient.mock.callCount(), 0);
        assert.equal(results.at(-2)!.status, "FAIL");
        assert.equal(results.at(-1)!.status, "SKIP");
        assert.doesNotMatch(JSON.stringify(results), /private-config-value/);
    });
}

for (const failure of ["missing", "read-error", "tool", "invalid-environment"]) {
    test(`credential failure ${failure} prevents HTTP requests`, async (t) => {
        const { dependencies, read, toolAvailable, createRemoteClient, environment } = fixture(t);
        if (failure === "missing") read.mock.mockImplementation(() => undefined);
        if (failure === "read-error")
            read.mock.mockImplementation(() => {
                throw new Error("private-read-error");
            });
        if (failure === "tool") toolAvailable.mock.mockImplementation(() => false);
        if (failure === "invalid-environment") environment.BB_TOKEN = "";
        const results = await runDoctor(dependencies, { remote: true });
        assert.equal(createRemoteClient.mock.callCount(), 0);
        assert.ok(results.some((check) => check.status === "FAIL"));
        assert.equal(results.at(-1)!.status, "SKIP");
        assert.doesNotMatch(JSON.stringify(results), /private-read-error/);
    });
}
