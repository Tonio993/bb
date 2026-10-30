import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { BitbucketApiError } from "../../../src/bitbucket/bitbucket-api-error.ts";
import {
    BitbucketClient,
    type FetchImplementation,
} from "../../../src/bitbucket/bitbucket-client.ts";
import type {
    BitbucketCommitMessageSuggestion,
    BitbucketPage,
    BitbucketPullRequest,
    BitbucketPullRequestTask,
} from "../../../src/bitbucket/bitbucket-types.ts";
import { runCli } from "../../../src/cli/cli.ts";
import type { CommandContext } from "../../../src/cli/command-context.ts";
import type { BbConfig } from "../../../src/config/config-schema.ts";
import type { GitOperations } from "../../../src/git/git-types.ts";
import { createGitStub } from "../../helpers/git-stub.ts";

function createFixture(t: TestContext) {
    const config: BbConfig = {
        bitbucket: {
            url: "https://bitbucket.example/bitbucket",
            projectKey: "PROJECT",
            defaultReviewers: [],
        },
        git: { remote: "origin" },
    };
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    const current: BitbucketPullRequest = {
        id: 42,
        version: 7,
        state: "OPEN",
        reviewers: [],
        fromRef: { id: "refs/heads/feature/current", displayId: "feature/current", repository },
        toRef: { id: "refs/heads/develop", displayId: "develop", repository },
        links: {
            self: [
                {
                    href: "https://bitbucket.example/bitbucket/projects/PROJECT/repos/payments/pull-requests/42",
                },
            ],
        },
    };
    const listed: BitbucketPullRequest = { ...current, version: 1, reviewers: [] };
    const merged: BitbucketPullRequest = { ...current, state: "MERGED" };
    const refreshed = structuredClone(current);
    refreshed.version = 8;
    let detailReads = 0;
    const suggestion: BitbucketCommitMessageSuggestion = {
        title: "Pull request #42: validate payments",
        body: "Merge feature/current to develop",
    };
    const pages: BitbucketPage<BitbucketPullRequest>[] = [
        {
            values: [listed],
            size: 1,
            limit: 100,
            start: 0,
            isLastPage: true,
        },
    ];
    const failures = { merge: 0, suggestion: 0 };
    const taskPages: BitbucketPage<BitbucketPullRequestTask>[] = [
        {
            values: [],
            size: 0,
            limit: 100,
            start: 0,
            isLastPage: true,
        },
    ];
    const taskDetails = new Map<number, BitbucketPullRequestTask>();
    const taskFailures = new Map<number, number>();
    const taskCompletion = { confirmed: true };
    const requests: { path: string; method: string; body: unknown }[] = [];
    const request = t.mock.fn<FetchImplementation>(
        async (input: string | URL | Request, options?: RequestInit) => {
            const url = new URL(String(input));
            const path = `${url.pathname}${url.search}`;
            const method = options?.method ?? "GET";
            requests.push({
                path,
                method,
                body:
                    options?.body === undefined
                        ? undefined
                        : (JSON.parse(String(options.body)) as unknown),
            });

            if (method === "GET" && url.pathname.endsWith("/42/blocker-comments")) {
                const page = taskPages.shift();
                assert.ok(page, "Unexpected task page requested.");
                return Response.json(page);
            }
            const taskMatch = url.pathname.match(/\/42\/comments\/(\d+)$/);
            if (taskMatch) {
                const id = Number(taskMatch[1]);
                const task = taskDetails.get(id);
                assert.ok(task, "Unexpected task requested.");
                if (method === "GET") {
                    return Response.json(task);
                }
                if (method === "PUT") {
                    const failure = taskFailures.get(id);
                    if (failure) {
                        return Response.json(
                            { errors: [{ message: "Task update was rejected." }] },
                            { status: failure },
                        );
                    }
                    const completed = {
                        ...task,
                        state: taskCompletion.confirmed ? "RESOLVED" : "OPEN",
                        version: task.version + 1,
                    };
                    taskDetails.set(id, completed);
                    return Response.json(completed);
                }
            }

            if (method === "POST" && url.pathname.endsWith("/42/merge")) {
                return failures.merge
                    ? Response.json(
                          { errors: [{ message: "Merge was rejected by Bitbucket." }] },
                          { status: failures.merge },
                      )
                    : Response.json(merged);
            }
            if (method === "GET" && url.pathname.endsWith("/42/commit-message-suggestion")) {
                return failures.suggestion
                    ? Response.json(
                          { errors: [{ message: "Suggestion is unavailable." }] },
                          { status: failures.suggestion },
                      )
                    : Response.json(suggestion);
            }
            if (method === "GET" && url.pathname.endsWith("/pull-requests/42")) {
                return Response.json(detailReads++ === 0 ? current : refreshed);
            }
            if (method === "GET" && url.pathname.endsWith("/pull-requests")) {
                const page = pages.shift();
                assert.ok(page, "Unexpected Pull Request page requested.");
                return Response.json(page);
            }
            throw new Error(`Unexpected REST request: ${method} ${path}`);
        },
    );
    const currentBranch = t.mock.fn(() => "feature/current");
    const currentRepository = t.mock.fn(() => "payments");
    const runGit = t.mock.fn<GitOperations["run"]>(() => {
        throw new Error("Merging must use REST.");
    });
    const fetchGit = t.mock.fn<GitOperations["fetch"]>(() => {
        throw new Error("Merging must not fetch Git references.");
    });
    const git = createGitStub({ currentBranch, currentRepository, run: runGit, fetch: fetchGit });
    const output = t.mock.method(console, "log", () => {});
    const context: CommandContext = {
        get tokenStore(): never {
            throw new Error("Token storage is already injected in the clients.");
        },
        config,
        gitClient: git,
        bitbucketClient: new BitbucketClient(config.bitbucket, () => "test-token", {
            fetch: request,
        }),
        get configStore(): never {
            throw new Error("Configuration is already loaded.");
        },
    };
    return {
        current,
        listed,
        merged,
        suggestion,
        pages,
        failures,
        requests,
        output,
        refreshed,
        taskPages,
        taskDetails,
        taskFailures,
        taskCompletion,
        currentBranch,
        currentRepository,
        runGit,
        fetchGit,
        run: (args: string[]) => runCli(["merge-pr", ...args], context),
    };
}

const basePath = "/bitbucket/rest/api/latest/projects/PROJECT/repos/payments/pull-requests";

test("merge-pr reads the current Pull Request and merges through REST with its latest version", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop"]);
    assert.deepEqual(fixture.requests, [
        { path: `${basePath}?state=OPEN&start=0&limit=100`, method: "GET", body: undefined },
        { path: `${basePath}/42`, method: "GET", body: undefined },
        { path: `${basePath}/42/merge`, method: "POST", body: { version: 7 } },
    ]);
    assert.equal(fixture.currentBranch.mock.callCount(), 1);
    assert.equal(fixture.currentRepository.mock.callCount(), 1);
    assert.equal(fixture.runGit.mock.callCount(), 0);
    assert.equal(fixture.fetchGit.mock.callCount(), 0);
    assert.deepEqual(
        fixture.output.mock.calls.map(({ arguments: args }) => args),
        [[fixture.merged.links.self[0].href]],
    );
});

test("a message prefix is applied to the suggested message and disables the automatic subject", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop", "--message-prefix", "[RELEASE] "]);
    assert.deepEqual(fixture.requests.slice(2), [
        { path: `${basePath}/42/commit-message-suggestion`, method: "GET", body: undefined },
        {
            path: `${basePath}/42/merge`,
            method: "POST",
            body: {
                version: 7,
                message:
                    "[RELEASE] Pull request #42: validate payments\n\nMerge feature/current to develop",
                autoSubject: false,
            },
        },
    ]);
});

test("a whitespace-only prefix leaves Bitbucket's default message unchanged", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop", "--message-prefix", "  "]);
    assert.equal(fixture.requests.length, 3);
    assert.deepEqual(fixture.requests[2].body, { version: 7 });
});

for (const args of [
    ["feature/current", "develop"],
    ["--source-branch", "feature/current", "--target-branch", "develop"],
]) {
    test(`explicit branches avoid querying the current branch: ${args.join(" ")}`, async (t) => {
        const fixture = createFixture(t);
        await fixture.run(args);
        assert.equal(fixture.currentBranch.mock.callCount(), 0);
    });
}

test("a named target resolves the current branch", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["--target-branch", "develop"]);
    assert.equal(fixture.currentBranch.mock.callCount(), 1);
});

test("project overrides and repository names are URL encoded and version zero is valid", async (t) => {
    const fixture = createFixture(t);
    fixture.currentRepository.mock.mockImplementation(() => "payments & accounts");
    fixture.current.toRef.repository.slug = "payments & accounts";
    fixture.current.toRef.repository.project.key = "OTHER PROJECT";
    fixture.current.version = 0;
    await fixture.run(["develop", "--project-key", " OTHER PROJECT "]);
    const path =
        "/bitbucket/rest/api/latest/projects/OTHER%20PROJECT/repos/payments%20%26%20accounts/pull-requests";
    assert.equal(fixture.requests[0].path, `${path}?state=OPEN&start=0&limit=100`);
    assert.equal(fixture.requests[1].path, `${path}/42`);
    assert.deepEqual(fixture.requests[2], {
        path: `${path}/42/merge`,
        method: "POST",
        body: { version: 0 },
    });
});

test("Pull Request discovery follows Bitbucket pagination", async (t) => {
    const fixture = createFixture(t);
    fixture.pages.unshift({
        values: [],
        size: 0,
        limit: 100,
        start: 0,
        isLastPage: false,
        nextPageStart: 100,
    });
    await fixture.run(["develop"]);
    assert.equal(fixture.requests[1].path, `${basePath}?state=OPEN&start=100&limit=100`);
    assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 1);
});

test("a missing Pull Request reports an error without attempting a merge", async (t) => {
    const fixture = createFixture(t);
    fixture.pages[0].values = [];
    await assert.rejects(
        fixture.run(["develop"]),
        /No open Pull Request found from 'feature\/current' to 'develop'/,
    );
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.output.mock.callCount(), 0);
});

for (const statuses of [["UNAPPROVED"], ["NEEDS_WORK"], ["APPROVED", "NEEDS_WORK"]]) {
    test(`current reviewer statuses ${statuses.join(",")} prevent merging and message retrieval`, async (t) => {
        const fixture = createFixture(t);
        fixture.current.reviewers = statuses.map((status) => ({ status }));
        await assert.rejects(
            fixture.run(["develop", "--message-prefix", "[RELEASE] "]),
            /no reviewer has approved|reviewer requested changes/,
        );
        assert.equal(fixture.requests.length, 2);
        assert.equal(fixture.output.mock.callCount(), 0);
    });
}

test("a current approval allows merging even when another reviewer has not approved", async (t) => {
    const fixture = createFixture(t);
    fixture.current.reviewers = [{ status: "APPROVED" }, { status: "UNAPPROVED" }];
    await fixture.run(["develop"]);
    assert.equal(fixture.requests[2].method, "POST");
});

for (const args of [
    [],
    ["develop", "develop"],
    ["feature/current", "--target-branch", "develop"],
    ["--source-branch", "feature/current"],
]) {
    test(`invalid branch arguments prevent all REST calls: ${JSON.stringify(args)}`, async (t) => {
        const fixture = createFixture(t);
        await assert.rejects(
            fixture.run(args),
            /Target branch is required|cannot be the same|cannot be combined/,
        );
        assert.equal(fixture.requests.length, 0);
        assert.equal(fixture.output.mock.callCount(), 0);
    });
}

for (const status of [401, 403, 404, 409]) {
    test(`a rejected merge preserves HTTP ${status} without retrying`, async (t) => {
        const fixture = createFixture(t);
        fixture.failures.merge = status;
        await assert.rejects(fixture.run(["develop"]), (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, status);
            assert.equal(error.method, "POST");
            assert.match(error.path ?? "", /\/42\/merge$/);
            return true;
        });
        assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 1);
        assert.equal(fixture.output.mock.callCount(), 0);
    });
}

test("an unavailable message suggestion blocks merging rather than dropping the requested prefix", async (t) => {
    const fixture = createFixture(t);
    fixture.failures.suggestion = 404;
    await assert.rejects(
        fixture.run(["develop", "--message-prefix", "[RELEASE] "]),
        (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, 404);
            return true;
        },
    );
    assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 0);
});

test("an empty message suggestion prevents submitting a prefix-only merge message", async (t) => {
    const fixture = createFixture(t);
    delete fixture.suggestion.title;
    delete fixture.suggestion.body;
    await assert.rejects(
        fixture.run(["develop", "--message-prefix", "[RELEASE] "]),
        /did not provide a merge commit message/,
    );
    assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 0);
});

test("a Pull Request closed since discovery is not submitted for merging", async (t) => {
    const fixture = createFixture(t);
    fixture.current.state = "DECLINED";
    await assert.rejects(fixture.run(["develop"]), /Only open Pull Requests can be merged/);
    assert.equal(fixture.requests.length, 2);
});

for (const ref of ["fromRef", "toRef"] as const) {
    test(`a changed ${ref} after discovery prevents merging a different branch pair`, async (t) => {
        const fixture = createFixture(t);
        fixture.current[ref] = { ...fixture.current[ref], id: "refs/heads/other-branch" };
        await assert.rejects(
            fixture.run(["develop"]),
            /Pull Request branches changed after discovery/,
        );
        assert.equal(fixture.requests.length, 2);
        assert.equal(fixture.output.mock.callCount(), 0);
    });
}

for (const version of [-1, 0.5, Number.NaN]) {
    test(`an invalid Pull Request version ${version} prevents merging`, async (t) => {
        const fixture = createFixture(t);
        fixture.current.version = version;
        await assert.rejects(
            fixture.run(["develop"]),
            /Unable to determine the Pull Request version/,
        );
        assert.equal(fixture.requests.length, 2);
    });
}

test("missing reviewer data from Bitbucket prevents merging", async (t) => {
    const fixture = createFixture(t);
    delete (fixture.current as Partial<BitbucketPullRequest>).reviewers;
    await assert.rejects(fixture.run(["develop"]), /did not provide.*reviewers/);
    assert.equal(fixture.requests.length, 2);
});

test("missing target repository data prevents merging", async (t) => {
    const fixture = createFixture(t);
    fixture.current.toRef.repository.project.key = "";
    await assert.rejects(fixture.run(["develop"]), /valid repository project key/);
    assert.equal(fixture.requests.length, 1);
});

test("a response that does not confirm MERGED is not reported as a successful merge", async (t) => {
    const fixture = createFixture(t);
    fixture.merged.state = "OPEN";
    await assert.rejects(
        fixture.run(["develop"]),
        /did not confirm that the Pull Request was merged/,
    );
    assert.equal(fixture.output.mock.callCount(), 0);
});

test("a merged Pull Request without a URL reports an explicit error", async (t) => {
    const fixture = createFixture(t);
    fixture.merged.links = { self: [] };
    await assert.rejects(fixture.run(["develop"]), /did not provide the merged Pull Request URL/);
    assert.equal(fixture.output.mock.callCount(), 0);
});

test("--complete-tasks reads all pages before resolving only open tasks with their current versions", async (t) => {
    const fixture = createFixture(t);
    fixture.taskPages.splice(
        0,
        1,
        {
            values: [
                { id: 101, version: 1, state: "OPEN", severity: "BLOCKER" },
                { id: 102, version: 2, state: "RESOLVED", severity: "BLOCKER" },
            ],
            size: 2,
            limit: 100,
            start: 0,
            isLastPage: false,
            nextPageStart: 100,
        },
        {
            values: [{ id: 103, version: 0, state: "OPEN", severity: "BLOCKER" }],
            size: 1,
            limit: 100,
            start: 100,
            isLastPage: true,
        },
    );
    fixture.taskDetails.set(101, { id: 101, version: 3, state: "OPEN", severity: "BLOCKER" });
    fixture.taskDetails.set(103, { id: 103, version: 5, state: "OPEN", severity: "BLOCKER" });
    await fixture.run(["develop", "--complete-tasks"]);
    assert.deepEqual(fixture.requests.slice(2), [
        {
            path: `${basePath}/42/blocker-comments?start=0&limit=100`,
            method: "GET",
            body: undefined,
        },
        {
            path: `${basePath}/42/blocker-comments?start=100&limit=100`,
            method: "GET",
            body: undefined,
        },
        { path: `${basePath}/42/comments/101`, method: "GET", body: undefined },
        {
            path: `${basePath}/42/comments/101`,
            method: "PUT",
            body: { version: 3, state: "RESOLVED" },
        },
        { path: `${basePath}/42/comments/103`, method: "GET", body: undefined },
        {
            path: `${basePath}/42/comments/103`,
            method: "PUT",
            body: { version: 5, state: "RESOLVED" },
        },
        { path: `${basePath}/42`, method: "GET", body: undefined },
        { path: `${basePath}/42/merge`, method: "POST", body: { version: 8 } },
    ]);
    assert.deepEqual(
        fixture.output.mock.calls.map(({ arguments: args }) => args),
        [[fixture.merged.links.self[0].href]],
    );
});

test("--complete-tasks merges successfully when the Pull Request has no tasks", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop", "--complete-tasks"]);
    assert.equal(fixture.requests.filter(({ method }) => method === "PUT").length, 0);
    assert.deepEqual(fixture.requests.at(-1)?.body, { version: 8 });
});

test("task completion skips tasks concurrently resolved or converted back to ordinary comments", async (t) => {
    const fixture = createFixture(t);
    fixture.taskPages[0].values = [
        { id: 101, version: 1, state: "OPEN", severity: "BLOCKER" },
        { id: 102, version: 1, state: "OPEN", severity: "BLOCKER" },
    ];
    fixture.taskDetails.set(101, { id: 101, version: 2, state: "RESOLVED", severity: "BLOCKER" });
    fixture.taskDetails.set(102, { id: 102, version: 2, state: "OPEN", severity: "NORMAL" });
    await fixture.run(["develop", "--complete-tasks"]);
    assert.equal(fixture.requests.filter(({ method }) => method === "PUT").length, 0);
    assert.equal(fixture.requests.at(-1)?.method, "POST");
});

for (const status of [403, 409]) {
    test(`a task update returning HTTP ${status} prevents merging without retrying`, async (t) => {
        const fixture = createFixture(t);
        const task = { id: 101, version: 1, state: "OPEN", severity: "BLOCKER" };
        fixture.taskPages[0].values = [task];
        fixture.taskDetails.set(101, task);
        fixture.taskFailures.set(101, status);
        await assert.rejects(fixture.run(["develop", "--complete-tasks"]), (error: unknown) => {
            assert.ok(error instanceof BitbucketApiError);
            assert.equal(error.statusCode, status);
            assert.equal(error.method, "PUT");
            return true;
        });
        assert.equal(fixture.requests.filter(({ method }) => method === "PUT").length, 1);
        assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 0);
        assert.equal(fixture.output.mock.callCount(), 0);
    });
}

test("a later task failure leaves completed tasks resolved and prevents merging", async (t) => {
    const fixture = createFixture(t);
    fixture.taskPages[0].values = [101, 102].map((id) => ({
        id,
        version: 1,
        state: "OPEN",
        severity: "BLOCKER",
    }));
    for (const task of fixture.taskPages[0].values) fixture.taskDetails.set(task.id, task);
    fixture.taskFailures.set(102, 403);
    await assert.rejects(fixture.run(["develop", "--complete-tasks"]), /Task update was rejected/);
    assert.equal(fixture.taskDetails.get(101)?.state, "RESOLVED");
    assert.equal(fixture.taskDetails.get(102)?.state, "OPEN");
    assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 0);
});

test("Bitbucket must confirm task completion before merging", async (t) => {
    const fixture = createFixture(t);
    const task = { id: 101, version: 1, state: "OPEN", severity: "BLOCKER" };
    fixture.taskPages[0].values = [task];
    fixture.taskDetails.set(101, task);
    fixture.taskCompletion.confirmed = false;
    await assert.rejects(
        fixture.run(["develop", "--complete-tasks"]),
        /did not confirm completion.*#101/,
    );
    assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 0);
});

for (const nextPageStart of [undefined, 0, -1, 0.5]) {
    test(`invalid task pagination ${nextPageStart} prevents task updates and merging`, async (t) => {
        const fixture = createFixture(t);
        fixture.taskPages[0].isLastPage = false;
        fixture.taskPages[0].nextPageStart = nextPageStart;
        await assert.rejects(
            fixture.run(["develop", "--complete-tasks"]),
            /next Pull Request task page/,
        );
        assert.equal(
            fixture.requests.filter(({ method }) => method === "PUT" || method === "POST").length,
            0,
        );
    });
}

test("review validation runs before task completion", async (t) => {
    const fixture = createFixture(t);
    fixture.current.reviewers = [{ status: "NEEDS_WORK" }];
    await assert.rejects(
        fixture.run(["develop", "--complete-tasks"]),
        /reviewer requested changes/,
    );
    assert.equal(fixture.requests.length, 2);
});

test("review validation runs again after task completion", async (t) => {
    const fixture = createFixture(t);
    fixture.refreshed.reviewers = [{ status: "NEEDS_WORK" }];
    await assert.rejects(
        fixture.run(["develop", "--complete-tasks"]),
        /reviewer requested changes/,
    );
    assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 0);
});

test("branch changes during task completion prevent merging a different branch pair", async (t) => {
    const fixture = createFixture(t);
    fixture.refreshed.toRef.id = "refs/heads/other-branch";
    await assert.rejects(
        fixture.run(["develop", "--complete-tasks"]),
        /branches changed while completing tasks/,
    );
    assert.equal(fixture.requests.filter(({ method }) => method === "POST").length, 0);
});

test("task completion can be combined with a prefixed merge message", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop", "--complete-tasks", "--message-prefix", "[RELEASE] "]);
    assert.equal(fixture.requests.at(-2)?.path, `${basePath}/42/commit-message-suggestion`);
    assert.deepEqual(fixture.requests.at(-1)?.body, {
        version: 8,
        message:
            "[RELEASE] Pull request #42: validate payments\n\nMerge feature/current to develop",
        autoSubject: false,
    });
});

test("malformed task details stop the workflow before updating tasks or merging", async (t) => {
    const fixture = createFixture(t);
    fixture.taskPages[0].values = [{ id: 101, version: 0, state: "OPEN", severity: "BLOCKER" }];
    fixture.taskDetails.set(101, {
        id: 101,
        version: Number.NaN,
        state: "OPEN",
        severity: "BLOCKER",
    });
    await assert.rejects(fixture.run(["develop", "--complete-tasks"]), (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.statusCode, 200);
        assert.equal(error.method, "GET");
        assert.match(error.path ?? "", /comments\/101$/);
        assert.match(error.message, /valid Pull Request task version/);
        return true;
    });
    assert.equal(
        fixture.requests.filter(({ method }) => method === "PUT" || method === "POST").length,
        0,
    );
});

test("a pagination failure after reading open tasks prevents all task updates and merging", async (t) => {
    const fixture = createFixture(t);
    const task = { id: 101, version: 1, state: "OPEN", severity: "BLOCKER" };
    fixture.taskPages.splice(
        0,
        1,
        { values: [task], size: 1, limit: 100, start: 0, isLastPage: false, nextPageStart: 37 },
        { values: [], size: 0, limit: 100, start: 37, isLastPage: false, nextPageStart: 37 },
    );
    fixture.taskDetails.set(101, task);
    await assert.rejects(
        fixture.run(["develop", "--complete-tasks"]),
        /next Pull Request task page/,
    );
    assert.equal(
        fixture.requests.filter(({ path }) => path.includes("blocker-comments?")).length,
        2,
    );
    assert.equal(fixture.requests.filter(({ path }) => path.endsWith("/comments/101")).length, 0);
    assert.equal(
        fixture.requests.filter(({ method }) => method === "PUT" || method === "POST").length,
        0,
    );
    assert.equal(fixture.output.mock.callCount(), 0);
});
