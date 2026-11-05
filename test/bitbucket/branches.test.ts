import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { BitbucketClient, type FetchImplementation } from "../../src/bitbucket/bitbucket-client.ts";
import { BitbucketApiError } from "../../src/bitbucket/bitbucket-api-error.ts";
import { deleteBranch } from "../../src/bitbucket/branches.ts";

const options = {
    projectKey: "~jane doe",
    repository: "payments & accounts",
    name: "refs/heads/feature/test",
    endPoint: "a".repeat(40),
};
function fixture(t: TestContext, response: Response = new Response(null, { status: 204 })) {
    const request = t.mock.fn<FetchImplementation>(async () => response);
    const client = new BitbucketClient("https://bitbucket.example/context", () => "test-token", {
        fetch: request,
    });
    return { client, request };
}

test("branch deletion uses branch-utils, the source ref and the expected commit", async (t) => {
    const f = fixture(t);
    await deleteBranch(f.client, options);
    const [url, init] = f.request.mock.calls[0].arguments;
    assert.equal(
        url,
        "https://bitbucket.example/context/rest/branch-utils/latest/projects/~jane%20doe/repos/payments%20%26%20accounts/branches",
    );
    assert.equal(init?.method, "DELETE");
    assert.deepEqual(JSON.parse(String(init?.body)), {
        name: options.name,
        endPoint: options.endPoint,
        dryRun: false,
    });
    assert.equal(f.request.mock.callCount(), 1);
});

for (const invalid of [
    { projectKey: " " },
    { repository: "" },
    { name: "feature/test" },
    { name: "refs/heads/" },
    { endPoint: "" },
]) {
    test(
        "branch deletion rejects incomplete identities before HTTP: " + JSON.stringify(invalid),
        async (t) => {
            const f = fixture(t);
            await assert.rejects(deleteBranch(f.client, { ...options, ...invalid }));
            assert.equal(f.request.mock.callCount(), 0);
        },
    );
}

for (const status of [400, 401, 403, 404, 409, 503]) {
    test("branch deletion preserves HTTP " + status + " without retrying", async (t) => {
        const f = fixture(
            t,
            Response.json({ errors: [{ message: "Deletion rejected." }] }, { status }),
        );
        await assert.rejects(deleteBranch(f.client, options), (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, status);
            assert.equal(error.method, "DELETE");
            return true;
        });
        assert.equal(f.request.mock.callCount(), 1);
    });
}

test("unexpected JSON cannot confirm branch deletion", async (t) => {
    const f = fixture(t, Response.json({ message: "unexpected" }));
    await assert.rejects(deleteBranch(f.client, options), /Expected an empty response/);
});

test("a branch deletion timeout is reported without retrying", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const request = t.mock.fn<FetchImplementation>(
        (_input, init) =>
            new Promise((_resolve, reject) => {
                init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
                    once: true,
                });
            }),
    );
    const client = new BitbucketClient("https://bitbucket.example", () => "test-token", {
        fetch: request,
        timeoutMs: 50,
    });
    const pending = deleteBranch(client, options);
    t.mock.timers.tick(50);
    await assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.kind, "timeout");
        assert.equal(error.method, "DELETE");
        return true;
    });
    assert.equal(request.mock.callCount(), 1);
});
