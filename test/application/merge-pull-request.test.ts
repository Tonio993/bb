import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { mergeOpenPullRequest } from "../../src/application/merge-pull-request.ts";
import { BitbucketApiError } from "../../src/bitbucket/bitbucket-api-error.ts";
import { BitbucketClient, type FetchImplementation } from "../../src/bitbucket/bitbucket-client.ts";
import type { BitbucketPullRequest } from "../../src/bitbucket/bitbucket-types.ts";

function fixture(t: TestContext) {
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    const current: BitbucketPullRequest = {
        id: 42,
        version: 7,
        state: "OPEN",
        reviewers: [],
        fromRef: { id: "refs/heads/feature/test", displayId: "feature/test", repository },
        toRef: { id: "refs/heads/develop", displayId: "develop", repository },
        links: { self: [{ href: "https://bitbucket.example/pull-requests/42" }] },
    };
    const merged = { ...current, state: "MERGED" };
    const responses: { body: unknown; status?: number }[] = [
        {
            body: {
                values: [{ ...current, version: 1 }],
                size: 1,
                limit: 100,
                start: 0,
                isLastPage: true,
            },
        },
        { body: current },
        { body: merged },
    ];
    const requests: { method: string; path: string; body: unknown }[] = [];
    const request = t.mock.fn<FetchImplementation>(
        async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            requests.push({
                method: init?.method ?? "GET",
                path: `${url.pathname}${url.search}`,
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            });
            const response = responses.shift();
            assert.ok(response, "Unexpected REST request.");
            return Response.json(response.body, { status: response.status ?? 200 });
        },
    );
    const client = new BitbucketClient(
        { url: "https://bitbucket.example", projectKey: "PROJECT", defaultReviewers: [] },
        () => "test-token",
        { fetch: request },
    );
    return {
        current,
        merged,
        requests,
        responses,
        run: () =>
            mergeOpenPullRequest(client, {
                projectKey: "PROJECT",
                repository: "payments",
                sourceBranch: "feature/test",
                targetBranch: "develop",
            }),
    };
}

test("the application workflow merges with the current version without a CLI or Git context", async (t) => {
    const api = fixture(t);
    assert.deepEqual(await api.run(), api.merged);
    const path = "/rest/api/latest/projects/PROJECT/repos/payments/pull-requests";
    assert.deepEqual(api.requests, [
        { method: "GET", path: `${path}?state=OPEN&start=0&limit=100`, body: undefined },
        { method: "GET", path: `${path}/42`, body: undefined },
        { method: "POST", path: `${path}/42/merge`, body: { version: 7 } },
    ]);
});

test("the application workflow blocks merging when the current review requests changes", async (t) => {
    const api = fixture(t);
    api.current.reviewers = [{ status: "NEEDS_WORK" }];
    await assert.rejects(api.run(), /reviewer requested changes/);
    assert.equal(api.requests.length, 2);
    assert.equal(
        api.requests.some(({ method }) => method === "POST"),
        false,
    );
});

test("the application workflow propagates merge conflicts without retrying", async (t) => {
    const api = fixture(t);
    api.responses[2] = { status: 409, body: { errors: [{ message: "Merge conflict." }] } };
    await assert.rejects(api.run(), (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.method, "POST");
        assert.match(error.message, /Merge conflict/);
        return true;
    });
    assert.equal(api.requests.filter(({ method }) => method === "POST").length, 1);
});
