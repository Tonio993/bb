import assert from "node:assert/strict";
import { test } from "node:test";

import { BitbucketApiError } from "../../src/bitbucket/bitbucket-api-error.ts";
import { BitbucketClient, type FetchImplementation } from "../../src/bitbucket/bitbucket-client.ts";

function createClient(request: FetchImplementation, timeoutMs?: number) {
    return new BitbucketClient("https://bitbucket.example/bitbucket///", () => "test-token", {
        timeoutMs,
        fetch: request,
    });
}

const path = "/rest/api/latest/projects/PROJECT/repos/payments/pull-requests";

test("clients keep their injected HTTP transports isolated during concurrent requests", async (t) => {
    const first = t.mock.fn<FetchImplementation>(async () => Response.json({ id: 1 }));
    const second = t.mock.fn<FetchImplementation>(async () => Response.json({ id: 2 }));
    const responses = await Promise.all([
        createClient(first).get(path),
        createClient(second).get(path),
    ]);
    assert.deepEqual(responses, [{ id: 1 }, { id: 2 }]);
    assert.equal(first.mock.callCount(), 1);
    assert.equal(second.mock.callCount(), 1);
});

test("HTTP requests preserve the server context path and normalize boundary slashes", async (t) => {
    const request = t.mock.fn<FetchImplementation>(async () => Response.json({ id: 42 }));
    assert.deepEqual(await createClient(request).get(path), { id: 42 });
    const [url, options] = request.mock.calls[0].arguments;
    assert.equal(
        url,
        "https://bitbucket.example/bitbucket/rest/api/latest/projects/PROJECT/repos/payments/pull-requests",
    );
    assert.equal(options?.method, "GET");
    assert.deepEqual(options?.headers, {
        Authorization: "Bearer test-token",
        Accept: "application/json",
    });
    assert.equal(options?.body, undefined);
});

for (const method of ["post", "put"] as const) {
    test(`${method.toUpperCase()} serializes Unicode JSON with the required content type`, async (t) => {
        const request = t.mock.fn<FetchImplementation>(async () => Response.json({ id: 42 }));
        const body = { title: "Payment €", description: "First line\nSecond line" };
        await createClient(request)[method](path, body);
        const options = request.mock.calls[0].arguments[1];
        assert.equal(options?.method, method.toUpperCase());
        assert.deepEqual(options?.headers, {
            Authorization: "Bearer test-token",
            Accept: "application/json",
            "Content-Type": "application/json; charset=utf-8",
        });
        assert.equal(options?.body, JSON.stringify(body));
    });
}

test("DELETE handles a successful response with no content", async (t) => {
    const request = t.mock.fn<FetchImplementation>(async () => new Response(null, { status: 204 }));
    assert.equal(await createClient(request).delete(path), undefined);
    assert.equal(request.mock.calls[0].arguments[1]?.method, "DELETE");
});

for (const status of [400, 401, 403, 404, 409, 503]) {
    test(`HTTP ${status} retains its status, method, path, and server message`, async (t) => {
        const request = t.mock.fn<FetchImplementation>(async () =>
            Response.json({ errors: [{ message: "Request rejected." }] }, { status }),
        );
        await assert.rejects(createClient(request).post(path, { version: 7 }), (error: unknown) => {
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
    {
        body: JSON.stringify({
            errors: [null, {}, { message: 12 }, { message: " First " }, { message: "Second" }],
        }),
        expected: "First; Second",
    },
    { body: JSON.stringify({ errors: [], message: " Main error " }), expected: "Main error" },
    { body: " Upstream service unavailable ", expected: "Upstream service unavailable" },
    { body: JSON.stringify({ errors: ["invalid", { message: " " }] }), expected: "Bad Gateway" },
    { body: "null", expected: "Bad Gateway" },
    { body: "", expected: "Bad Gateway" },
];
for (const { body, expected } of errorBodies) {
    test(`HTTP error parsing handles ${JSON.stringify(body)}`, async (t) => {
        const request = t.mock.fn<FetchImplementation>(
            async () => new Response(body, { status: 502, statusText: "Bad Gateway" }),
        );
        await assert.rejects(createClient(request).get(path), (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.message, `Bitbucket API request failed [502]: ${expected}`);
            return true;
        });
    });
}

test("an empty error response without a status description has a useful fallback", async (t) => {
    const request = t.mock.fn<FetchImplementation>(
        async () => new Response(null, { status: 500, statusText: "" }),
    );
    await assert.rejects(createClient(request).get(path), /Unknown Bitbucket error/);
});

test("connection failures retain method and path without inventing an HTTP status", async (t) => {
    const request = t.mock.fn<FetchImplementation>(async () => {
        throw new Error("Connection reset.");
    });
    await assert.rejects(createClient(request).get(path), (error: unknown) => {
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
    t.mock.method(response, "text", async () => {
        throw new Error("Response stream closed.");
    });
    const request = t.mock.fn<FetchImplementation>(async () => response);
    await assert.rejects(createClient(request).get(path), (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.statusCode, 502);
        assert.equal(error.method, "GET");
        assert.equal(error.path, path);
        assert.match(error.message, /Response stream closed/);
        return true;
    });
});

for (const content of ["<html>Login page with private contents</html>", "{broken JSON"]) {
    test("successful non-JSON responses report a structured error without displaying their body", async (t) => {
        const request = t.mock.fn<FetchImplementation>(async () => new Response(content));
        await assert.rejects(createClient(request).get(path), (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, 200);
            assert.equal(error.method, "GET");
            assert.equal(error.path, path);
            assert.match(error.message, /Expected a JSON response/);
            assert.ok(!error.message.includes(content));
            return true;
        });
        assert.equal(request.mock.callCount(), 1);
    });
}

for (const stage of ["connection", "response body"] as const) {
    test(`the request deadline aborts a stalled ${stage} without retrying a write`, async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let signal: AbortSignal | undefined;
        let reading = false;
        const request = t.mock.fn<FetchImplementation>(
            async (_input: string | URL | Request, options?: RequestInit) => {
                signal = options?.signal ?? undefined;
                assert.ok(signal);
                const stalled = () =>
                    new Promise<never>((_resolve, reject) => {
                        signal!.addEventListener("abort", () => reject(signal!.reason), {
                            once: true,
                        });
                    });
                if (stage === "connection") return stalled();
                const response = new Response("pending", { status: 201 });
                t.mock.method(response, "text", () => {
                    reading = true;
                    return stalled();
                });
                return response;
            },
        );
        const pending = createClient(request, 50).post(path, { title: "Create once" });
        await Promise.resolve();
        if (stage === "response body") assert.equal(reading, true);
        t.mock.timers.tick(49);
        assert.equal(signal?.aborted, false);
        t.mock.timers.tick(1);
        await assert.rejects(pending, (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, stage === "connection" ? undefined : 201);
            assert.equal(error.method, "POST");
            assert.equal(error.path, path);
            assert.match(error.message, /timed out after 50 ms/);
            assert.match(error.message, /Check the server state/);
            return true;
        });
        assert.equal(signal?.aborted, true);
        assert.equal(request.mock.callCount(), 1);
    });
}

test("the default deadline is 60 seconds", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal: AbortSignal | undefined;
    const request = t.mock.fn<FetchImplementation>(
        (_input: string | URL | Request, options?: RequestInit) => {
            signal = options?.signal ?? undefined;
            return new Promise<never>((_resolve, reject) => {
                signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
            });
        },
    );
    const pending = createClient(request).get(path);
    t.mock.timers.tick(59999);
    assert.equal(signal?.aborted, false);
    t.mock.timers.tick(1);
    await assert.rejects(pending, /timed out after 60000 ms/);
});

for (const outcome of ["success", "HTTP failure", "parser failure"] as const) {
    test(`the deadline is cleared after ${outcome}`, async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let signal: AbortSignal | undefined;
        const request = t.mock.fn<FetchImplementation>(
            async (_input: string | URL | Request, options?: RequestInit) => {
                signal = options?.signal ?? undefined;
                return Response.json(
                    { id: 42 },
                    { status: outcome === "HTTP failure" ? 409 : 200 },
                );
            },
        );
        const pending = createClient(request, 50).get(path, (value) => {
            if (outcome === "parser failure") throw new Error("Expected a page.");
            return value;
        });
        if (outcome === "success") await pending;
        else await assert.rejects(pending, BitbucketApiError);
        t.mock.timers.tick(50);
        assert.equal(signal?.aborted, false);
    });
}

for (const timeout of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648]) {
    test(`invalid timeout ${timeout} is rejected`, () => {
        const request: FetchImplementation = async () => Response.json({});
        assert.throws(() => createClient(request, timeout), /timeout must be a positive integer/);
    });
}

test("an endpoint requiring a JSON object rejects an empty successful response with its HTTP context", async (t) => {
    const request = t.mock.fn<FetchImplementation>(async () => new Response(null, { status: 204 }));
    await assert.rejects(
        createClient(request).get(path, (value) => {
            if (value === undefined) throw new Error("Expected a Pull Request object.");
            return value;
        }),
        (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, 204);
            assert.equal(error.method, "GET");
            assert.equal(error.path, path);
            assert.match(error.message, /Expected a Pull Request object/);
            return true;
        },
    );
});
