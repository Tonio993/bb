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
            sshHostnames: [],
        },
        git: { remote: "origin" },
    };
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    const current: BitbucketPullRequest = {
        id: 42,
        version: 7,
        state: "OPEN",
        reviewers: [],
        fromRef: {
            id: "refs/heads/feature/current",
            displayId: "feature/current",
            repository,
            latestCommit: "a".repeat(40),
        },
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
    const failures = { merge: 0, suggestion: 0, deletion: 0 };
    const deletion = { error: undefined as Error | undefined, unexpectedBody: false };
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

            if (method === "DELETE" && url.pathname.includes("/rest/branch-utils/latest/")) {
                if (deletion.error) throw deletion.error;
                if (failures.deletion)
                    return Response.json(
                        { errors: [{ message: "Source branch deletion was rejected." }] },
                        { status: failures.deletion },
                    );
                return deletion.unexpectedBody
                    ? Response.json({ message: "unexpected" })
                    : new Response(null, { status: 204 });
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
    const remoteFetchUrl = t.mock.fn(
        () => "https://bitbucket.example/bitbucket/scm/PROJECT/payments.git",
    );
    const runGit = t.mock.fn<GitOperations["run"]>(() => {
        throw new Error("Merging must use REST.");
    });
    const fetchGit = t.mock.fn<GitOperations["fetch"]>(() => {
        throw new Error("Merging must not fetch Git references.");
    });
    const git = createGitStub({ currentBranch, remoteFetchUrl, run: runGit, fetch: fetchGit });
    const output = t.mock.method(console, "log", () => {});
    const errors = t.mock.method(console, "error", () => {});
    const previousExitCode = process.exitCode;
    t.after(() => {
        process.exitCode = previousExitCode;
    });
    const context: CommandContext = {
        get doctor(): never {
            throw new Error("Doctor must remain lazy.");
        },
        get tokenStore(): never {
            throw new Error("Token storage is already injected in the clients.");
        },
        config,
        gitClient: git,
        bitbucketClient: new BitbucketClient(config.bitbucket.url, () => "test-token", {
            fetch: request,
        }),
        get configStore(): never {
            throw new Error("Configuration is already loaded.");
        },
    };
    return {
        config,
        context,
        current,
        listed,
        merged,
        suggestion,
        pages,
        failures,
        deletion,
        requests,
        output,
        errors,
        refreshed,
        taskPages,
        taskDetails,
        taskFailures,
        taskCompletion,
        currentBranch,
        remoteFetchUrl,
        runGit,
        fetchGit,
        run: (args: string[]) => runCli(["merge-pr", ...args], context),
    };
}

const basePath = "/bitbucket/rest/api/latest/projects/PROJECT/repos/payments/pull-requests";

for (const dryRun of [false, true]) {
    test("mismatching task identity prevents writes, dryRun=" + dryRun, async (t) => {
        const f = createFixture(t);
        const task = { id: 101, version: 0, state: "OPEN", severity: "BLOCKER" };
        f.taskPages[0].values = [task];
        f.taskDetails.set(101, { ...task, id: 999 });
        await assert.rejects(
            f.run(["develop", "--complete-tasks", ...(dryRun ? ["--dry-run"] : [])]),
            /different Pull Request task identity/,
        );
        assert.ok(f.requests.every((request) => request.method === "GET"));
        assert.equal(f.output.mock.callCount(), 0);
    });
}

for (const json of [false, true]) {
    for (const completeTasks of [false, true]) {
        test(
            "merge dry-run uses only GETs, json=" + json + ", completeTasks=" + completeTasks,
            async (t) => {
                const f = createFixture(t);
                const open = {
                    id: 101,
                    version: 2,
                    state: "OPEN",
                    severity: "BLOCKER",
                    text: "Fix tests",
                };
                f.taskPages[0].values = [open, { ...open, id: 102, state: "RESOLVED" }];
                f.taskDetails.set(101, open);
                f.current.fromRef.repository = {
                    name: "Fork",
                    slug: "fork",
                    project: { key: "FORK" },
                };
                Object.defineProperty(f.context, "gitClient", {
                    get() {
                        throw new Error("Explicit merge must not initialize Git.");
                    },
                });
                await f.run([
                    "feature/current",
                    "develop",
                    "--project-key",
                    "PROJECT",
                    "--repository",
                    "payments",
                    "--dry-run",
                    "--delete-source",
                    ...(completeTasks ? ["--complete-tasks"] : []),
                    ...(json ? ["--json"] : []),
                ]);
                assert.ok(f.requests.every((request) => request.method === "GET"));
                assert.equal(f.requests.at(-1)?.path, basePath + "/42/commit-message-suggestion");
                assert.equal(f.requests.length, completeTasks ? 5 : 3);
                assert.equal(open.state, "OPEN");
                const raw = String(f.output.mock.calls[0].arguments[0]);
                if (json) {
                    const result = JSON.parse(raw);
                    assert.equal(result.ok, true);
                    assert.equal(result.data.dryRun, true);
                    assert.equal(result.data.pullRequest.state, "OPEN");
                    assert.equal(result.data.plan.tasksToComplete.length, completeTasks ? 1 : 0);
                    assert.equal(result.data.plan.messageMode, "server-default");
                    assert.equal(
                        result.data.plan.message,
                        f.suggestion.title + "\n\n" + f.suggestion.body,
                    );
                    assert.deepEqual(result.data.plan.sourceDeletion, {
                        projectKey: "FORK",
                        repository: "fork",
                        ref: "refs/heads/feature/current",
                        expectedCommit: "a".repeat(40),
                        afterConfirmedMerge: true,
                    });
                    assert.equal(result.data.sourceDeletion, undefined);
                } else {
                    assert.match(raw, /Dry run: no tasks were completed/);
                    assert.match(raw, /Delete source after confirmed merge: FORK\/fork/);
                }
            },
        );
    }
}
test("merge preview uses an explicit prefixed suggestion and no deletion by default", async (t) => {
    const f = createFixture(t);
    await f.run(["develop", "--dry-run", "--message-prefix", "[RELEASE] ", "--json"]);
    const result = JSON.parse(String(f.output.mock.calls[0].arguments[0]));
    assert.equal(result.data.plan.messageMode, "explicit");
    assert.ok(result.data.plan.message.startsWith("[RELEASE] " + f.suggestion.title));
    assert.equal(result.data.plan.sourceDeletion, null);
});
test("dry-run plans tasks using current details after collecting all pages", async (t) => {
    const f = createFixture(t);
    const task = { id: 101, version: 0, state: "OPEN", severity: "BLOCKER" };
    f.taskPages[0] = { ...f.taskPages[0], values: [task], isLastPage: false, nextPageStart: 37 };
    f.taskPages.push({ ...f.taskPages[0], values: [{ ...task, id: 102 }], isLastPage: true });
    f.taskDetails.set(101, { ...task, state: "RESOLVED", version: 1 });
    f.taskDetails.set(102, { ...task, id: 102, version: 3 });
    await f.run(["develop", "--dry-run", "--complete-tasks", "--json"]);
    const result = JSON.parse(String(f.output.mock.calls[0].arguments[0]));
    assert.deepEqual(result.data.plan.tasksToComplete, [{ id: 102, version: 3, text: null }]);
    assert.ok(f.requests[3].path.endsWith("start=37&limit=100"));
    assert.ok(f.requests[4].path.endsWith("/comments/101"));
    assert.ok(f.requests.every((request) => request.method === "GET"));
});
test("dry-run preserves reviewer blockers before task reads", async (t) => {
    const f = createFixture(t);
    f.current.reviewers = [{ status: "NEEDS_WORK" }];
    await assert.rejects(f.run(["develop", "--dry-run", "--complete-tasks"]), /requested changes/);
    assert.equal(f.requests.length, 2);
    assert.equal(f.output.mock.callCount(), 0);
});
test("dry-run rejects unsafe source deletion before reading tasks", async (t) => {
    const f = createFixture(t);
    f.current.fromRef.latestCommit = "short";
    await assert.rejects(
        f.run(["develop", "--dry-run", "--delete-source", "--complete-tasks"]),
        /full source commit/,
    );
    assert.equal(f.requests.length, 2);
});
test("suggestion errors in dry-run produce a JSON error without a plan or writes", async (t) => {
    const f = createFixture(t);
    f.failures.suggestion = 403;
    await f.run(["develop", "--dry-run", "--json"]);
    const result = JSON.parse(String(f.output.mock.calls[0].arguments[0]));
    assert.equal(result.error.code, "ACCESS_DENIED");
    assert.equal(result.data, null);
    assert.ok(f.requests.every((request) => request.method === "GET"));
});

test("--delete-source deletes only after a confirmed merge and prints the PR URL", async (t) => {
    const f = createFixture(t);
    await f.run(["develop", "--delete-source"]);
    assert.deepEqual(
        f.requests.map(({ method }) => method),
        ["GET", "GET", "POST", "DELETE"],
    );
    assert.deepEqual(f.requests.at(-1), {
        path: "/bitbucket/rest/branch-utils/latest/projects/PROJECT/repos/payments/branches",
        method: "DELETE",
        body: { name: "refs/heads/feature/current", endPoint: "a".repeat(40), dryRun: false },
    });
    assert.deepEqual(
        f.output.mock.calls.map(({ arguments: args }) => args),
        [[f.merged.links.self[0].href]],
    );
    assert.equal(f.errors.mock.callCount(), 0);
    assert.equal(f.runGit.mock.callCount(), 0);
    assert.equal(f.fetchGit.mock.callCount(), 0);
});

test("source deletion uses the PR source repository for a fork", async (t) => {
    const f = createFixture(t);
    f.current.fromRef.repository = {
        name: "Fork",
        slug: "fork-payments",
        project: { key: "~jane" },
    };
    await f.run(["develop", "--delete-source"]);
    assert.equal(
        f.requests.at(-1)!.path,
        "/bitbucket/rest/branch-utils/latest/projects/~jane/repos/fork-payments/branches",
    );
    assert.equal(f.requests.at(-2)!.path, `${basePath}/42/merge`);
});

for (const commit of [undefined, "abc123"]) {
    test(
        "unsafe deletion metadata prevents merge and task writes: " + JSON.stringify(commit),
        async (t) => {
            const f = createFixture(t);
            f.current.fromRef.latestCommit = commit;
            await assert.rejects(
                f.run(["develop", "--delete-source", "--complete-tasks"]),
                /full source commit/,
            );
            assert.deepEqual(
                f.requests.map(({ method }) => method),
                ["GET", "GET"],
            );
        },
    );
}

test("an unconfirmed merge never triggers source deletion", async (t) => {
    const f = createFixture(t);
    f.merged.state = "OPEN";
    await assert.rejects(f.run(["develop", "--delete-source"]), /did not confirm.*merged/);
    assert.equal(
        f.requests.some(({ method }) => method === "DELETE"),
        false,
    );
    assert.equal(f.output.mock.callCount(), 0);
});

test("a response for a different PR cannot confirm the merge for source deletion", async (t) => {
    const f = createFixture(t);
    f.merged.id = 43;
    await assert.rejects(f.run(["develop", "--delete-source"]), /did not confirm.*merged/);
    assert.equal(
        f.requests.some(({ method }) => method === "DELETE"),
        false,
    );
    assert.equal(f.output.mock.callCount(), 0);
});

test("a merge rejection never triggers source deletion", async (t) => {
    const f = createFixture(t);
    f.failures.merge = 409;
    await assert.rejects(f.run(["develop", "--delete-source"]), BitbucketApiError);
    assert.equal(
        f.requests.some(({ method }) => method === "DELETE"),
        false,
    );
});

test("review validation still blocks merge and source deletion", async (t) => {
    const f = createFixture(t);
    f.current.reviewers = [{ status: "NEEDS_WORK" }];
    await assert.rejects(f.run(["develop", "--delete-source"]), /reviewer requested changes/);
    assert.equal(
        f.requests.some(({ method }) => method !== "GET"),
        false,
    );
});

for (const status of [400, 403, 404, 409, 503]) {
    test(
        "a rejected deletion reports partial success without repeating merge: HTTP " + status,
        async (t) => {
            const f = createFixture(t);
            f.failures.deletion = status;
            await f.run(["develop", "--delete-source"]);
            assert.equal(process.exitCode, 1);
            assert.deepEqual(
                f.output.mock.calls.map(({ arguments: args }) => args),
                [[f.merged.links.self[0].href]],
            );
            assert.equal(f.errors.mock.callCount(), 1);
            assert.match(
                String(f.errors.mock.calls[0].arguments[0]),
                /was merged, but source branch deletion failed or could not be confirmed/,
            );
            assert.match(String(f.errors.mock.calls[0].arguments[0]), /Check the branch state/);
            assert.equal(f.requests.filter(({ method }) => method === "POST").length, 1);
            assert.equal(f.requests.filter(({ method }) => method === "DELETE").length, 1);
        },
    );
}

test("a deletion timeout is a partial success with an explicit recovery message", async (t) => {
    const f = createFixture(t);
    f.deletion.error = new BitbucketApiError("Deletion timed out.", {
        kind: "timeout",
        method: "DELETE",
    });
    await f.run(["develop", "--delete-source"]);
    assert.equal(process.exitCode, 1);
    assert.equal(f.output.mock.callCount(), 1);
    assert.match(String(f.errors.mock.calls[0].arguments[0]), /was merged.*Deletion timed out/);
    assert.equal(f.requests.filter(({ method }) => method === "DELETE").length, 1);
});

test("unexpected deletion JSON is not treated as successful cleanup", async (t) => {
    const f = createFixture(t);
    f.deletion.unexpectedBody = true;
    await f.run(["develop", "--delete-source"]);
    assert.equal(process.exitCode, 1);
    assert.match(String(f.errors.mock.calls[0].arguments[0]), /Expected an empty response/);
});

test("changed merge metadata preserves the source branch and reports partial success", async (t) => {
    const f = createFixture(t);
    f.merged.fromRef = { ...f.current.fromRef, latestCommit: "b".repeat(40) };
    await f.run(["develop", "--delete-source"]);
    assert.equal(process.exitCode, 1);
    assert.equal(
        f.requests.some(({ method }) => method === "DELETE"),
        false,
    );
    assert.equal(f.output.mock.callCount(), 1);
    assert.match(String(f.errors.mock.calls[0].arguments[0]), /deletion was skipped/);
});

test("partial success remains explicit even when the merged PR has no URL", async (t) => {
    const f = createFixture(t);
    f.failures.deletion = 403;
    f.merged.links = { self: [] };
    await f.run(["develop", "--delete-source"]);
    assert.equal(process.exitCode, 1);
    assert.equal(f.output.mock.callCount(), 0);
    assert.match(String(f.errors.mock.calls[0].arguments[0]), /Pull Request #42 was merged/);
});

test("task completion and message prefixes use the latest validated source commit for deletion", async (t) => {
    const f = createFixture(t);
    f.taskPages[0].values = [{ id: 101, version: 1, state: "OPEN", severity: "BLOCKER" }];
    f.taskDetails.set(101, { id: 101, version: 1, state: "OPEN", severity: "BLOCKER" });
    f.refreshed.fromRef.latestCommit = "b".repeat(40);
    f.merged.fromRef = { ...f.current.fromRef, latestCommit: "b".repeat(40) };
    await f.run([
        "develop",
        "--complete-tasks",
        "--message-prefix",
        "[RELEASE] ",
        "--delete-source",
    ]);
    const methods = f.requests.map(({ method }) => method);
    assert.ok(methods.indexOf("PUT") < methods.indexOf("POST"));
    assert.equal(f.requests.at(-2)!.path, `${basePath}/42/merge`);
    assert.deepEqual(f.requests.at(-2)!.body, {
        version: 8,
        message:
            "[RELEASE] Pull request #42: validate payments\n\nMerge feature/current to develop",
        autoSubject: false,
    });
    assert.deepEqual(f.requests.at(-1)!.body, {
        name: "refs/heads/feature/current",
        endPoint: "b".repeat(40),
        dryRun: false,
    });
    assert.equal(f.errors.mock.callCount(), 0);
});

test("a changed source repository during tasks prevents merge and deletion", async (t) => {
    const f = createFixture(t);
    f.refreshed.fromRef.repository = { name: "Other", slug: "other", project: { key: "OTHER" } };
    await assert.rejects(
        f.run(["develop", "--complete-tasks", "--delete-source"]),
        /branches changed while completing tasks/,
    );
    assert.equal(
        f.requests.some(({ method }) => method === "POST" || method === "DELETE"),
        false,
    );
});

test("manual source deletion with explicit branches and identity does not initialize Git", async (t) => {
    const f = createFixture(t);
    delete f.config.bitbucket.projectKey;
    Object.defineProperty(f.context, "gitClient", {
        get() {
            throw new Error("Git must remain lazy.");
        },
    });
    await f.run([
        "feature/current",
        "develop",
        "--project-key",
        "PROJECT",
        "--repository",
        "payments",
        "--delete-source",
    ]);
    assert.equal(f.requests.at(-1)!.method, "DELETE");
    assert.equal(f.errors.mock.callCount(), 0);
});

test("manual merge with explicit branches and identity does not initialize Git", async (t) => {
    const fixture = createFixture(t);
    delete fixture.config.bitbucket.projectKey;
    Object.defineProperty(fixture.context, "gitClient", {
        get() {
            throw new Error("Git must remain lazy.");
        },
    });
    await fixture.run([
        "feature/current",
        "develop",
        "--project-key",
        " PROJECT ",
        "--repository",
        " payments ",
    ]);
    assert.equal(fixture.requests.at(-1)!.method, "POST");
    assert.equal(fixture.remoteFetchUrl.mock.callCount(), 0);
});

test("merge-pr reads the current Pull Request and merges through REST with its latest version", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop"]);
    assert.deepEqual(fixture.requests, [
        { path: `${basePath}?state=OPEN&start=0&limit=100`, method: "GET", body: undefined },
        { path: `${basePath}/42`, method: "GET", body: undefined },
        { path: `${basePath}/42/merge`, method: "POST", body: { version: 7 } },
    ]);
    assert.equal(fixture.currentBranch.mock.callCount(), 1);
    assert.equal(fixture.remoteFetchUrl.mock.callCount(), 1);
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

test("project overrides are URL encoded and version zero is valid", async (t) => {
    const fixture = createFixture(t);
    fixture.current.toRef.repository.project.key = "OTHER PROJECT";
    fixture.current.version = 0;
    await fixture.run(["develop", "--project-key", " OTHER PROJECT "]);
    const path = "/bitbucket/rest/api/latest/projects/OTHER%20PROJECT/repos/payments/pull-requests";
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
