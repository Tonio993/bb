import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { BitbucketClient, type FetchImplementation } from "../src/bitbucket/bitbucket-client.ts";
import type { BitbucketPage, BitbucketPullRequest, BitbucketRepository } from "../src/bitbucket/bitbucket-types.ts";
import { getOpenPullRequest, getOpenPullRequests } from "../src/bitbucket/pull-requests.ts";
import { getProjectRepositories } from "../src/bitbucket/repositories.ts";
import { runCli } from "../src/cli/cli.ts";
import type { CommandContext } from "../src/cli/command-context.ts";
import { createGitStub } from "./helpers/git-stub.ts";

const root = "/rest/api/latest/projects/PROJECT/repos";
const config = {
    bitbucket: { url: "https://bitbucket.example", projectKey: "PROJECT", defaultReviewers: [] },
    git: { remote: "origin" },
};

function createApi(t: TestContext) {
    const responses: { path: string; body: unknown }[] = [];
    const requests: string[] = [];
    const request = t.mock.fn<FetchImplementation>(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const path = `${url.pathname}${url.search}`;
        requests.push(path);
        const response = responses.shift();
        assert.ok(response, `Unexpected request: ${path}`);
        assert.equal(path, response.path);
        return Response.json(response.body);
    });
    return { client: new BitbucketClient(config.bitbucket, () => "test-token", { fetch: request }), responses, requests };
}

function repository(name: string, slug: string): BitbucketRepository {
    return { name, slug, project: { key: "PROJECT" } };
}

function page<T>(values: T[], options: Partial<BitbucketPage<T>> = {}): BitbucketPage<T> {
    return { values, size: values.length, limit: 100, start: 0, isLastPage: true, ...options };
}

function pullRequest(id: number, repo: BitbucketRepository, source = "feature/test", target = "develop"): BitbucketPullRequest {
    return {
        id, version: 0, state: "OPEN", reviewers: [],
        fromRef: { id: `refs/heads/${source}`, displayId: source, repository: repo },
        toRef: { id: `refs/heads/${target}`, displayId: target, repository: repo },
        links: { self: [{ href: `https://bitbucket.example/projects/PROJECT/repos/${repo.slug}/pull-requests/${id}` }] },
    };
}

test("repository discovery uses nextPageStart and URL encodes the project key", async (t) => {
    const api = createApi(t);
    const first = repository("Payments", "payments");
    const second = repository("Accounts", "accounts");
    const path = "/rest/api/latest/projects/OTHER%20PROJECT/repos";
    api.responses.push(
        { path: `${path}?start=0&limit=100`, body: page([first], { isLastPage: false, nextPageStart: 37 }) },
        { path: `${path}?start=37&limit=100`, body: page([second], { start: 37 }) },
    );
    assert.deepEqual(await getProjectRepositories(api.client, "OTHER PROJECT"), [first, second]);
    assert.equal(api.responses.length, 0);
});

test("single-repository discovery checks both branch refs and follows pages until a match", async (t) => {
    const api = createApi(t);
    const repo = repository("Payments", "payments");
    const match = pullRequest(3, repo);
    api.responses.push(
        { path: `${root}/payments/pull-requests?state=OPEN&start=0&limit=100`, body: page([
            pullRequest(1, repo, "feature/other"), pullRequest(2, repo, "feature/test", "main"),
        ], { isLastPage: false, nextPageStart: 17 }) },
        { path: `${root}/payments/pull-requests?state=OPEN&start=17&limit=100`, body: page([match], { start: 17 }) },
    );
    assert.deepEqual(await getOpenPullRequest(api.client, {
        projectKey: "PROJECT", repository: "payments", sourceBranch: "feature/test", targetBranch: "develop",
    }), match);
});

test("single-repository discovery stops immediately when a match is found", async (t) => {
    const api = createApi(t);
    const match = pullRequest(1, repository("Payments", "payments"));
    api.responses.push({
        path: `${root}/payments/pull-requests?state=OPEN&start=0&limit=100`,
        body: page([match], { isLastPage: false, nextPageStart: 100 }),
    });
    assert.deepEqual(await getOpenPullRequest(api.client, {
        projectKey: "PROJECT", repository: "payments", sourceBranch: "feature/test", targetBranch: "develop",
    }), match);
    assert.equal(api.requests.length, 1);
});

test("project-wide discovery handles repository and Pull Request pagination together", async (t) => {
    const api = createApi(t);
    const first = repository("Payments", "payments");
    const second = repository("Accounts", "accounts");
    const matches = [pullRequest(1, first), pullRequest(2, first), pullRequest(3, second)];
    api.responses.push(
        { path: `${root}?start=0&limit=100`, body: page([first], { isLastPage: false, nextPageStart: 17 }) },
        { path: `${root}?start=17&limit=100`, body: page([second], { start: 17 }) },
        { path: `${root}/payments/pull-requests?state=OPEN&start=0&limit=100`, body: page([matches[0]], { isLastPage: false, nextPageStart: 42 }) },
        { path: `${root}/payments/pull-requests?state=OPEN&start=42&limit=100`, body: page([matches[1], pullRequest(99, first, "other")], { start: 42 }) },
        { path: `${root}/accounts/pull-requests?state=OPEN&start=0&limit=100`, body: page([matches[2]]) },
    );
    const result = await getOpenPullRequests(api.client, { projectKey: "PROJECT", sourceBranch: "feature/test", targetBranch: "develop" });
    assert.deepEqual(result, matches.map((match) => ({ ...match, repository: match.toRef.repository })));
    assert.equal(api.responses.length, 0);
});

const repositories = [
    repository("Payment Gateway", "service-payments"),
    repository("User API", "api-1"),
    repository("User APIs", "api-12"),
    repository("service.+", "literal"),
    repository("serviceZZ", "other"),
];
const filterCases: { filter: string | undefined; indices: number[] }[] = [
    { filter: undefined, indices: [0, 1, 2, 3, 4] },
    { filter: " ", indices: [0, 1, 2, 3, 4] },
    { filter: "*", indices: [0, 1, 2, 3, 4] },
    { filter: " SERVICE-* ", indices: [0] },
    { filter: "*PAYMENT*", indices: [0] },
    { filter: "api-?", indices: [1] },
    { filter: "service.+", indices: [3] },
    { filter: "User API", indices: [1] },
    { filter: "*missing*", indices: [] },
];
for (const { filter, indices } of filterCases) {
    test(`repository wildcard ${JSON.stringify(filter)} matches names or slugs without querying excluded repositories`, async (t) => {
        const api = createApi(t);
        api.responses.push({ path: `${root}?start=0&limit=100`, body: page(repositories) });
        for (const index of indices) {
            const repo = repositories[index];
            api.responses.push({
                path: `${root}/${repo.slug}/pull-requests?state=OPEN&start=0&limit=100`,
                body: page([pullRequest(index + 1, repo)]),
            });
        }
        const matches = await getOpenPullRequests(api.client, {
            projectKey: "PROJECT", sourceBranch: "feature/test", targetBranch: "develop", repositoryFilter: filter,
        });
        assert.deepEqual(matches.map(({ repository: repo }) => repo.slug), indices.map((index) => repositories[index].slug));
        assert.equal(api.requests.length, indices.length + 1);
        assert.equal(api.responses.length, 0);
    });
}

for (const nextPageStart of [undefined, 0, -1, 0.5]) {
    for (const scope of ["repositories", "single repository", "project Pull Requests"]) {
        test(`invalid pagination ${nextPageStart} fails promptly for ${scope}`, async (t) => {
            const api = createApi(t);
            const brokenPage = page([], { isLastPage: false, nextPageStart });
            const options = { projectKey: "PROJECT", sourceBranch: "feature/test", targetBranch: "develop" };
            if (scope === "repositories") {
                api.responses.push({ path: `${root}?start=0&limit=100`, body: brokenPage });
                await assert.rejects(getProjectRepositories(api.client, "PROJECT"), /next repository page/);
            } else {
                if (scope === "project Pull Requests") {
                    api.responses.push({ path: `${root}?start=0&limit=100`, body: page([repository("Payments", "payments")]) });
                }
                api.responses.push({ path: `${root}/payments/pull-requests?state=OPEN&start=0&limit=100`, body: brokenPage });
                await assert.rejects(scope === "single repository"
                    ? getOpenPullRequest(api.client, { ...options, repository: "payments" })
                    : getOpenPullRequests(api.client, options), /next Pull Request page/);
            }
            assert.equal(api.requests.length, scope === "project Pull Requests" ? 2 : 1);
        });
    }
}

function createContext(t: TestContext, client: BitbucketClient, projectWide: boolean): CommandContext {
    const git = createGitStub({
        currentRepository: t.mock.fn(() => "payments"),
        currentBranch: () => { throw new Error("Both branches are already known."); },
    });
    return {
        config, bitbucketClient: client,
        get tokenStore(): never { throw new Error("Token storage is already injected in the client."); },
        get configStore(): never { throw new Error("Configuration is already loaded."); },
        get gitClient() {
            assert.equal(projectWide, false, "Project-wide discovery must not query Git.");
            return git;
        },
    };
}

for (const command of ["get-pr-url", "get-pr-urls"]) {
    test(`${command} succeeds without output when no matching Pull Request exists`, async (t) => {
        const api = createApi(t);
        const projectWide = command === "get-pr-urls";
        if (projectWide) api.responses.push({ path: `${root}?start=0&limit=100`, body: page([repository("Payments", "payments")]) });
        api.responses.push({ path: `${root}/payments/pull-requests?state=OPEN&start=0&limit=100`, body: page([]) });
        const output = t.mock.method(console, "log", () => {});
        await runCli([command, "feature/test", "develop"], createContext(t, api.client, projectWide));
        assert.equal(output.mock.callCount(), 0);
    });
}

test("get-pr-urls prints only matching URLs and forwards the repository filter", async (t) => {
    const api = createApi(t);
    const repo = repository("Payments", "service-payments");
    const matches = [pullRequest(1, repo), pullRequest(2, repo)];
    api.responses.push(
        { path: `${root}?start=0&limit=100`, body: page([repo, repository("Users", "users")]) },
        { path: `${root}/service-payments/pull-requests?state=OPEN&start=0&limit=100`, body: page(matches) },
    );
    const output = t.mock.method(console, "log", () => {});
    await runCli(["get-pr-urls", "feature/test", "develop", "--repository-filter", "service-*"], createContext(t, api.client, true));
    assert.deepEqual(output.mock.calls.map(({ arguments: args }) => args), matches.map(({ links }) => [links.self[0].href]));
    assert.equal(api.responses.length, 0);
});

test("get-pr-urls rejects identical branches before reading configuration or querying Bitbucket", async () => {
    const context: CommandContext = {
        get tokenStore(): never { throw new Error("Token storage must remain lazy."); },
        get config(): never { throw new Error("Configuration must remain lazy."); },
        get configStore(): never { throw new Error("Configuration must remain lazy."); },
        get gitClient(): never { throw new Error("Git must not be queried."); },
        get bitbucketClient(): never { throw new Error("Bitbucket must not be queried."); },
    };
    await assert.rejects(runCli(["get-pr-urls", "develop", "develop"], context), /Source and target branches cannot be the same/);
});
