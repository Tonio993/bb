import assert from "node:assert/strict";
import { test } from "node:test";

import { BitbucketApiError } from "../src/bitbucket/bitbucket-api-error.ts";
import { BitbucketClient } from "../src/bitbucket/bitbucket-client.ts";

function createClient() {
    return new BitbucketClient({
        url: "https://bitbucket.example/bitbucket///", projectKey: "PROJECT", defaultReviewers: [],
    }, () => "test-token");
}

const path = "/rest/api/latest/projects/PROJECT/repos/payments/pull-requests";

test("HTTP requests preserve the server context path and normalize boundary slashes", async (t) => {
    const request = t.mock.method(globalThis, "fetch", async () => Response.json({ id: 42 }));
    assert.deepEqual(await createClient().get<{ id: number }>(path), { id: 42 });
    const [url, options] = request.mock.calls[0].arguments;
    assert.equal(url, "https://bitbucket.example/bitbucket/rest/api/latest/projects/PROJECT/repos/payments/pull-requests");
    assert.equal(options?.method, "GET");
    assert.deepEqual(options?.headers, { Authorization: "Bearer test-token", Accept: "application/json" });
    assert.equal(options?.body, undefined);
});

for (const method of ["post", "put"] as const) {
    test(`${method.toUpperCase()} serializes Unicode JSON with the required content type`, async (t) => {
        const request = t.mock.method(globalThis, "fetch", async () => Response.json({ id: 42 }));
        const body = { title: "Payment €", description: "First line\nSecond line" };
        await createClient()[method](path, body);
        const options = request.mock.calls[0].arguments[1];
        assert.equal(options?.method, method.toUpperCase());
        assert.deepEqual(options?.headers, {
            Authorization: "Bearer test-token", Accept: "application/json",
            "Content-Type": "application/json; charset=utf-8",
        });
        assert.equal(options?.body, JSON.stringify(body));
    });
}

test("DELETE handles a successful response with no content", async (t) => {
    const request = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
    assert.equal(await createClient().delete<void>(path), undefined);
    assert.equal(request.mock.calls[0].arguments[1]?.method, "DELETE");
});

for (const status of [400, 401, 403, 404, 409, 503]) {
    test(`HTTP ${status} retains its status, method, path, and server message`, async (t) => {
        t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "Request rejected." }] }, { status }));
        await assert.rejects(createClient().post(path, { version: 7 }), (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, status);
            assert.equal(error.method, "POST");
            assert.equal(error.path, path);
            assert.match(error.message, /Request rejected/);
            return true;
        });
    });
}

const errorBodies = [
    { body: JSON.stringify({ errors: [null, {}, { message: 12 }, { message: " First " }, { message: "Second" }] }), expected: "First; Second" },
    { body: JSON.stringify({ errors: [], message: " Main error " }), expected: "Main error" },
    { body: " Upstream service unavailable ", expected: "Upstream service unavailable" },
    { body: JSON.stringify({ errors: ["invalid", { message: " " }] }), expected: "Bad Gateway" },
    { body: "null", expected: "Bad Gateway" },
    { body: "", expected: "Bad Gateway" },
];
for (const { body, expected } of errorBodies) {
    test(`HTTP error parsing handles ${JSON.stringify(body)}`, async (t) => {
        t.mock.method(globalThis, "fetch", async () => new Response(body, { status: 502, statusText: "Bad Gateway" }));
        await assert.rejects(createClient().get(path), (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.message, `Bitbucket API request failed [502]: ${expected}`);
            return true;
        });
    });
}

test("an empty error response without a status description has a useful fallback", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 500, statusText: "" }));
    await assert.rejects(createClient().get(path), /Unknown Bitbucket error/);
});

test("connection failures retain method and path without inventing an HTTP status", async (t) => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Connection reset."); });
    await assert.rejects(createClient().get(path), (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.statusCode, undefined);
        assert.equal(error.method, "GET");
        assert.equal(error.path, path);
        assert.match(error.message, /Unable to connect to Bitbucket: Connection reset/);
        return true;
    });
});

test("response body failures retain the HTTP status, method, and path", async (t) => {
    const response = new Response("partial body", { status: 502 });
    t.mock.method(response, "text", async () => { throw new Error("Response stream closed."); });
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(createClient().get(path), (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.statusCode, 502);
        assert.equal(error.method, "GET");
        assert.equal(error.path, path);
        assert.match(error.message, /Response stream closed/);
        return true;
    });
});
