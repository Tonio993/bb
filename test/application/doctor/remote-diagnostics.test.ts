import assert from "node:assert/strict";
import { test } from "node:test";
import {
    diagnoseRemoteAccess,
    classifyRemoteFailure,
} from "../../../src/application/doctor/remote-diagnostics.ts";
import { BitbucketClient } from "../../../src/bitbucket/bitbucket-client.ts";
import type { FetchImplementation } from "../../../src/bitbucket/bitbucket-client.ts";

const page = { size: 0, limit: 1, start: 0, isLastPage: true, values: [] };
function client(fetch: FetchImplementation, timeoutMs = 1000) {
    return new BitbucketClient("https://example.invalid/bitbucket", () => "private-token", {
        fetch,
        timeoutMs,
        redirect: "manual",
    });
}

test("remote checks perform one authenticated read, preserve context paths, and disable redirects", async (t) => {
    const fetch = t.mock.fn<FetchImplementation>(async () => Response.json(page));
    const results = await diagnoseRemoteAccess(() => client(fetch));
    assert.deepEqual(
        results.map((check) => check.status),
        ["OK", "OK"],
    );
    assert.equal(fetch.mock.callCount(), 1);
    const [url, init] = fetch.mock.calls[0].arguments;
    assert.equal(
        url,
        "https://example.invalid/bitbucket/rest/api/latest/dashboard/pull-requests?limit=1&start=0",
    );
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-token");
    assert.doesNotMatch(JSON.stringify(results), /private-token/);
});

for (const [status, message] of [
    [401, /Authentication was rejected/],
    [403, /Access was denied/],
    [404, /endpoint was not found/],
    [302, /redirect/],
    [429, /HTTP 429/],
    [503, /server or proxy failed/],
] as const) {
    test("remote HTTP " + status + " is classified from structured failure data", () => {
        const results = classifyRemoteFailure({ kind: "http", statusCode: status });
        assert.deepEqual(
            results.map((check) => check.status),
            ["OK", "FAIL"],
        );
        assert.match(results[1].message, message);
    });
}

for (const body of ["<html>private-server-content</html>", "", '{"private-server-content":true}']) {
    test(`remote success responses require a valid dashboard page: ${body}`, async () => {
        const results = await diagnoseRemoteAccess(() => client(async () => new Response(body)));
        assert.deepEqual(
            results.map((check) => check.status),
            ["OK", "FAIL"],
        );
        assert.match(results[1].message, /not valid Bitbucket dashboard JSON/);
        assert.doesNotMatch(JSON.stringify(results), /private-server-content/);
    });
}

test("connection failures skip authentication and do not display native error messages", async () => {
    const results = await diagnoseRemoteAccess(() =>
        client(async () => {
            throw new Error("private-native-error");
        }),
    );
    assert.deepEqual(
        results.map((check) => check.status),
        ["FAIL", "SKIP"],
    );
    assert.match(results[0].message, /DNS, network, proxy, and TLS/);
    assert.doesNotMatch(JSON.stringify(results), /private-native-error/);
});

for (const stage of ["connection", "body"]) {
    test(`remote ${stage} timeouts use structured error information`, async () => {
        const fetch: FetchImplementation = async (_url, init) => {
            const blocked = () =>
                new Promise<string>((_resolve, reject) => {
                    init!.signal!.addEventListener(
                        "abort",
                        () => reject(new Error("private-timeout-error")),
                        { once: true },
                    );
                });
            if (stage === "connection") {
                await blocked();
                throw new Error("Unreachable");
            }
            const response = Response.json(page);
            response.text = blocked;
            return response;
        };
        const results = await diagnoseRemoteAccess(() => client(fetch, 20));
        assert.equal(results[0].status, stage === "connection" ? "FAIL" : "OK");
        assert.equal(results[1].status, stage === "connection" ? "SKIP" : "FAIL");
        assert.match(results[stage === "connection" ? 0 : 1].message, /timed out/);
        assert.doesNotMatch(JSON.stringify(results), /private-timeout-error/);
    });
}

test("an HTTP error keeps its status diagnosis even when its response body cannot be read", async () => {
    const response = new Response(null, { status: 403 });
    response.text = async () => {
        throw new Error("private-body-error");
    };
    const results = await diagnoseRemoteAccess(() => client(async () => response));
    assert.equal(results[0].status, "OK");
    assert.equal(results[1].status, "FAIL");
    assert.match(results[1].message, /Access was denied \(HTTP 403\)/);
    assert.doesNotMatch(JSON.stringify(results), /private-body-error/);
});

test("remote HTTP failures hide response details and are not retried", async (t) => {
    const fetch = t.mock.fn<FetchImplementation>(async () =>
        Response.json({ message: "private-server-content" }, { status: 401 }),
    );
    const results = await diagnoseRemoteAccess(() => client(fetch));
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(results[1].status, "FAIL");
    assert.doesNotMatch(JSON.stringify(results), /private-server-content|private-token/);
});

test("timeout classification takes precedence over a received response status", () => {
    const results = classifyRemoteFailure({ kind: "timeout", statusCode: 403 });
    assert.equal(results[0].status, "OK");
    assert.equal(results[1].status, "FAIL");
    assert.match(results[1].message, /timed out/);
});
