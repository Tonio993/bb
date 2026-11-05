import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { BitbucketApiError } from "../../src/bitbucket/bitbucket-api-error.ts";
import { BitbucketClient, type FetchImplementation } from "../../src/bitbucket/bitbucket-client.ts";
import { createPullRequest, getPullRequest } from "../../src/bitbucket/pull-requests.ts";
import { getOpenPullRequest } from "../../src/bitbucket/pull-request-search.ts";
import { getProjectRepositories } from "../../src/bitbucket/repositories.ts";
import { parseCommitMessageSuggestion, parseTask } from "../../src/bitbucket/response-parsers.ts";

const identity = { projectKey: "PROJECT", repository: "payments", pullRequestId: 42 };
const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
const pr = {
    id: 42,
    version: 0,
    state: "OPEN",
    reviewers: [{ status: "APPROVED" }],
    fromRef: { id: "refs/heads/feature/test", displayId: "feature/test", repository },
    toRef: { id: "refs/heads/develop", displayId: "develop", repository },
    links: { self: [{ href: "https://bitbucket.example/pull-requests/42" }] },
};
const page = { values: [repository], size: 1, limit: 100, start: 0, isLastPage: true };

function api(t: TestContext, body: unknown, status = 200) {
    const request = t.mock.fn<FetchImplementation>(async () => Response.json(body, { status }));
    const client = new BitbucketClient("https://bitbucket.example", () => "test-token", {
        fetch: request,
    });
    return { client, request };
}

function invalidResponse(error: unknown): boolean {
    assert.ok(error instanceof BitbucketApiError);
    assert.match(error.message, /Invalid Bitbucket response/);
    assert.equal(error.statusCode, 200);
    assert.equal(error.method, "GET");
    assert.ok(error.path?.startsWith("rest/api/latest/projects/PROJECT/repos"));
    return true;
}

test("Pull Request refs expose the optional latest commit", async (t) => {
    const f = api(t, { ...pr, fromRef: { ...pr.fromRef, latestCommit: "a".repeat(40) } });
    const result = await getPullRequest(f.client, identity);
    assert.equal(result.fromRef.latestCommit, "a".repeat(40));
    assert.equal(result.toRef.latestCommit, undefined);
});

for (const latestCommit of [null, 42, "", " "]) {
    test(
        "Pull Request refs reject an invalid latest commit: " + JSON.stringify(latestCommit),
        async (t) => {
            const f = api(t, { ...pr, fromRef: { ...pr.fromRef, latestCommit } });
            await assert.rejects(getPullRequest(f.client, identity), invalidResponse);
        },
    );
}

test("REST operations URL encode opaque project and repository identifiers independently of discovery", async (t) => {
    const identifiers = { projectKey: "OTHER PROJECT/", repository: "payments & accounts" };
    const expected =
        "/rest/api/latest/projects/OTHER%20PROJECT%2F/repos/payments%20%26%20accounts/pull-requests";
    const created = api(t, pr, 201);
    await createPullRequest(created.client, {
        ...identifiers,
        sourceBranch: "feature/test",
        targetBranch: "develop",
        title: "Title",
        description: "Description",
        reviewers: [],
    });
    assert.equal(new URL(String(created.request.mock.calls[0].arguments[0])).pathname, expected);
    const details = api(t, pr);
    await getPullRequest(details.client, { ...identifiers, pullRequestId: 42 });
    assert.equal(
        new URL(String(details.request.mock.calls[0].arguments[0])).pathname,
        expected + "/42",
    );
    const search = api(t, { ...page, values: [pr] });
    await getOpenPullRequest(search.client, {
        ...identifiers,
        sourceBranch: "feature/test",
        targetBranch: "develop",
    });
    assert.equal(new URL(String(search.request.mock.calls[0].arguments[0])).pathname, expected);
});

for (const body of [
    null,
    [],
    {},
    { ...page, values: {} },
    { ...page, isLastPage: "false" },
    { ...page, start: -1 },
    { ...page, limit: 0 },
    { ...page, size: 0.5 },
    { ...page, values: [null] },
    { ...page, values: [{ ...repository, slug: 42 }] },
]) {
    test(`repository pages reject malformed data ${JSON.stringify(body)}`, async (t) => {
        const { client, request } = api(t, body);
        await assert.rejects(getProjectRepositories(client, "PROJECT"), invalidResponse);
        assert.equal(request.mock.callCount(), 1);
    });
}

for (const body of [
    null,
    [],
    {},
    { ...pr, id: 0 },
    { ...pr, version: "0" },
    { ...pr, state: null },
    { ...pr, reviewers: null },
    { ...pr, reviewers: [null] },
    { ...pr, reviewers: [{ status: 1 }] },
    { ...pr, fromRef: null },
    { ...pr, toRef: { ...pr.toRef, repository: null } },
    { ...pr, links: null },
    { ...pr, links: { self: [null] } },
    { ...pr, links: { self: [{ href: 42 }] } },
]) {
    test(`Pull Request details reject malformed data ${JSON.stringify(body)}`, async (t) => {
        const { client, request } = api(t, body);
        await assert.rejects(getPullRequest(client, identity), invalidResponse);
        assert.equal(request.mock.callCount(), 1);
    });
}

test("malformed Pull Request list entries are rejected before branch matching", async (t) => {
    const { client } = api(t, { ...page, values: [{ ...pr, fromRef: {} }] });
    await assert.rejects(
        getOpenPullRequest(client, {
            ...identity,
            sourceBranch: "feature/test",
            targetBranch: "develop",
        }),
        invalidResponse,
    );
});

test("a malformed creation response retains HTTP 201 and is never retried", async (t) => {
    const { client, request } = api(t, {}, 201);
    await assert.rejects(
        createPullRequest(client, {
            ...identity,
            sourceBranch: "feature/test",
            targetBranch: "develop",
            title: "Title",
            description: "* Commit",
            reviewers: [],
        }),
        (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, 201);
            assert.equal(error.method, "POST");
            assert.match(error.message, /Invalid Bitbucket response/);
            return true;
        },
    );
    assert.equal(request.mock.callCount(), 1);
});

test("valid responses preserve version zero, an empty reviewer list, and unrecognized extra fields", async (t) => {
    const body = { ...pr, reviewers: [], serverExtension: "preserved" };
    const { client } = api(t, body);
    assert.deepEqual(await getPullRequest(client, identity), body);
});

for (const body of [
    null,
    {},
    { id: 1, version: null, state: "OPEN", severity: "BLOCKER" },
    { id: 1, version: 0, state: null, severity: "BLOCKER" },
    { id: 1, version: 0, state: "OPEN", severity: 1 },
]) {
    test(`task responses reject malformed data ${JSON.stringify(body)}`, () => {
        assert.throws(() => parseTask(body));
    });
}

test("ordinary and resolved task states remain available to the workflow", () => {
    for (const task of [
        { id: 1, version: 0, state: "RESOLVED", severity: "BLOCKER" },
        { id: 1, version: 0, state: "OPEN", severity: "NORMAL" },
    ])
        assert.deepEqual(parseTask(task), task);
});

test("message suggestions allow missing fields but reject non-string values", () => {
    assert.deepEqual(parseCommitMessageSuggestion({}), { title: undefined, body: undefined });
    for (const value of [null, [], { title: 1 }, { body: {} }]) {
        assert.throws(() => parseCommitMessageSuggestion(value));
    }
});
