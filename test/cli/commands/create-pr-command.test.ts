import assert from "node:assert/strict";
import { Command } from "commander";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { BitbucketApiError } from "../../../src/bitbucket/bitbucket-api-error.ts";
import {
    BitbucketClient,
    type FetchImplementation,
} from "../../../src/bitbucket/bitbucket-client.ts";
import type { BitbucketPullRequest } from "../../../src/bitbucket/bitbucket-types.ts";
import type { CommandContext } from "../../../src/cli/command-context.ts";
import { registerCreatePrCommand } from "../../../src/cli/commands/create-pr-command.ts";
import type { BbConfig } from "../../../src/config/config-schema.ts";
import type { GitOperations } from "../../../src/git/git-types.ts";
import { createGitStub } from "../../helpers/git-stub.ts";
import { GitCommandError } from "../../../src/git/git-command-error.ts";
import type { GitCommit } from "../../../src/git/git-types.ts";

function createFixture(t: TestContext) {
    const config: BbConfig = {
        bitbucket: {
            url: "https://bitbucket.example/bitbucket",
            projectKey: "PROJECT",
            defaultReviewers: ["mario", "luca"],
            sshHostnames: [],
        },
        git: { remote: "upstream" },
    };
    const events: string[] = [];
    const currentBranch = t.mock.fn(() => "feature/current");
    const remoteFetchUrl = t.mock.fn(
        () => "https://bitbucket.example/bitbucket/scm/PROJECT/payments.git",
    );
    const fetch = t.mock.fn<GitOperations["fetch"]>(() => {
        events.push("fetch");
    });
    const branchExists = t.mock.fn<GitOperations["assertRemoteBranchExists"]>((branch) => {
        events.push(`branch:${branch}`);
    });
    const commits: GitCommit[] = [
        { subject: "Validate payments", body: "Check account\nReject invalid amounts" },
    ];
    const readCommits = t.mock.fn<GitOperations["commitsBetween"]>(() => {
        events.push("commits");
        return commits;
    });
    const git = createGitStub({
        currentBranch,
        remoteFetchUrl,
        fetch,
        assertRemoteBranchExists: branchExists,
        commitsBetween: readCommits,
    });
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    const pullRequest: BitbucketPullRequest = {
        id: 42,
        version: 0,
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
    const request = t.mock.fn<FetchImplementation>(async () => {
        events.push("create");
        return Response.json(pullRequest, { status: 201 });
    });
    const output = t.mock.method(console, "log", () => {});
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
    const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
    registerCreatePrCommand(program, context);

    return {
        config,
        context,
        events,
        currentBranch,
        remoteFetchUrl,
        fetch,
        branchExists,
        readCommits,
        commits,
        pullRequest,
        request,
        output,
        run: (args: string[]) => program.parseAsync(["create-pr", ...args], { from: "user" }),
    };
}

for (const json of [false, true]) {
    test(
        "create dry-run shows generated content and never initializes REST, json=" + json,
        async (t) => {
            const f = createFixture(t);
            const previous = process.exitCode;
            t.after(() => {
                process.exitCode = previous;
            });
            Object.defineProperty(f.context, "bitbucketClient", {
                get() {
                    throw new Error("REST must remain lazy.");
                },
            });
            await f.run(["develop", "--dry-run", ...(json ? ["--json"] : [])]);
            assert.deepEqual(f.events, [
                "fetch",
                "branch:feature/current",
                "branch:develop",
                "commits",
            ]);
            assert.equal(f.request.mock.callCount(), 0);
            assert.equal(f.output.mock.callCount(), 1);
            const raw = String(f.output.mock.calls[0].arguments[0]);
            if (json) {
                const result = JSON.parse(raw);
                assert.equal(result.ok, true);
                assert.equal(result.data.dryRun, true);
                assert.equal(result.data.plan.title, "Validate payments");
                assert.equal(
                    result.data.plan.description,
                    "* Validate payments\n    * Check account\n    * Reject invalid amounts",
                );
                assert.deepEqual(result.data.plan.reviewers, ["mario", "luca"]);
                assert.deepEqual(result.data.git, { remote: "upstream", fetchPerformed: true });
                assert.equal(result.data.pullRequest, undefined);
            } else {
                assert.match(raw, /Dry run: no Pull Request was created/);
                assert.match(raw, /Description:\n\* Validate payments/);
                assert.match(raw, /Git fetch performed for remote: upstream/);
            }
        },
    );
}
test("create dry-run honors title, reviewer, branch and repository overrides", async (t) => {
    const f = createFixture(t);
    const previous = process.exitCode;
    t.after(() => {
        process.exitCode = previous;
    });
    await f.run([
        "feature/other",
        "release",
        "--dry-run",
        "--json",
        "--title",
        "Custom",
        "--no-reviewers",
        "--project-key",
        "OTHER",
        "--repository",
        "service",
    ]);
    const result = JSON.parse(String(f.output.mock.calls[0].arguments[0]));
    assert.deepEqual(result.data.plan, {
        projectKey: "OTHER",
        repository: "service",
        sourceBranch: "feature/other",
        targetBranch: "release",
        title: "Custom",
        description: "* Validate payments\n    * Check account\n    * Reject invalid amounts",
        reviewers: [],
    });
    assert.equal(f.currentBranch.mock.callCount(), 0);
    assert.equal(f.remoteFetchUrl.mock.callCount(), 0);
    assert.equal(f.request.mock.callCount(), 0);
});
test("create dry-run preserves Git failures without emitting a plan", async (t) => {
    const f = createFixture(t);
    f.fetch.mock.mockImplementation(() => {
        throw new Error("Fetch failed.");
    });
    await assert.rejects(f.run(["develop", "--dry-run"]), /Fetch failed/);
    assert.equal(f.request.mock.callCount(), 0);
    assert.equal(f.output.mock.callCount(), 0);
});
test("create dry-run rejects an empty commit comparison", async (t) => {
    const f = createFixture(t);
    f.commits.length = 0;
    await assert.rejects(f.run(["develop", "--dry-run"]), /No commits found/);
    assert.equal(f.request.mock.callCount(), 0);
});

test("create-pr fetches and validates remote branches before generating content and posting the Pull Request", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop"]);

    assert.deepEqual(fixture.events, [
        "fetch",
        "branch:feature/current",
        "branch:develop",
        "commits",
        "create",
    ]);
    assert.equal(fixture.currentBranch.mock.callCount(), 1);
    assert.deepEqual(fixture.fetch.mock.calls[0].arguments, ["upstream"]);
    assert.deepEqual(
        fixture.branchExists.mock.calls.map(({ arguments: args }) => args),
        [
            ["feature/current", "source", "upstream"],
            ["develop", "target", "upstream"],
        ],
    );
    assert.deepEqual(fixture.readCommits.mock.calls[0].arguments, [
        "refs/remotes/upstream/develop",
        "refs/remotes/upstream/feature/current",
    ]);
    assert.equal(fixture.request.mock.callCount(), 1);
    const [url, options] = fixture.request.mock.calls[0].arguments;
    assert.equal(
        url,
        "https://bitbucket.example/bitbucket/rest/api/latest/projects/PROJECT/repos/payments/pull-requests",
    );
    assert.equal(options?.method, "POST");
    assert.deepEqual(options?.headers, {
        Authorization: "Bearer test-token",
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
    });
    const body: unknown = JSON.parse(String(options?.body));
    assert.deepEqual(body, {
        title: "Validate payments",
        description: "* Validate payments\n    * Check account\n    * Reject invalid amounts",
        fromRef: { id: "refs/heads/feature/current" },
        toRef: { id: "refs/heads/develop" },
        reviewers: [{ user: { name: "mario" } }, { user: { name: "luca" } }],
    });
    assert.deepEqual(
        fixture.output.mock.calls.map(({ arguments: args }) => args),
        [[fixture.pullRequest.links.self[0].href]],
    );
});

test("explicit branches avoid querying the current branch and allow title and project overrides", async (t) => {
    const fixture = createFixture(t);
    await fixture.run([
        "feature/explicit",
        "main",
        "--title",
        " Custom title ",
        "--project-key",
        " OTHER PROJECT ",
    ]);
    assert.equal(fixture.currentBranch.mock.callCount(), 0);
    assert.deepEqual(fixture.readCommits.mock.calls[0].arguments, [
        "refs/remotes/upstream/main",
        "refs/remotes/upstream/feature/explicit",
    ]);
    const [url, options] = fixture.request.mock.calls[0].arguments;
    assert.equal(
        url,
        "https://bitbucket.example/bitbucket/rest/api/latest/projects/OTHER%20PROJECT/repos/payments/pull-requests",
    );
    const body: { title: string } = JSON.parse(String(options?.body));
    assert.equal(body.title, "Custom title");
});

test("creation uses the remote project instead of a stale configured project", async (t) => {
    const fixture = createFixture(t);
    fixture.config.bitbucket.projectKey = "STALE";
    await fixture.run(["develop"]);
    const url = new URL(String(fixture.request.mock.calls[0].arguments[0]));
    assert.match(url.pathname, /\/projects\/PROJECT\/repos\/payments\/pull-requests$/);
    assert.equal(fixture.remoteFetchUrl.mock.callCount(), 1);
    assert.deepEqual(fixture.remoteFetchUrl.mock.calls[0].arguments, ["upstream"]);
});

test("creation discovers the project when no default is configured", async (t) => {
    const fixture = createFixture(t);
    delete fixture.config.bitbucket.projectKey;
    await fixture.run(["develop"]);
    assert.match(
        String(fixture.request.mock.calls[0].arguments[0]),
        /\/projects\/PROJECT\/repos\/payments\//,
    );
});

test("manual repository selection skips remote discovery while preserving Git content generation", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["feature/test", "develop", "--repository", " manual "]);
    assert.equal(fixture.remoteFetchUrl.mock.callCount(), 0);
    assert.equal(fixture.fetch.mock.callCount(), 1);
    assert.equal(fixture.readCommits.mock.callCount(), 1);
    assert.match(
        String(fixture.request.mock.calls[0].arguments[0]),
        /\/projects\/PROJECT\/repos\/manual\//,
    );
});

test("creation accepts a configured SSH hostname association", async (t) => {
    const fixture = createFixture(t);
    fixture.config.bitbucket.sshHostnames = ["ssh-gateway"];
    fixture.remoteFetchUrl.mock.mockImplementation(() => "git@ssh-gateway:PROJECT/payments.git");
    await fixture.run(["develop"]);
    assert.equal(fixture.request.mock.callCount(), 1);
});

for (const remote of [
    "https://private-user:private-token@other.example/bitbucket/scm/PROJECT/payments.git",
    "https://bitbucket.example/another-instance/scm/PROJECT/payments.git",
    "git@ssh-gateway:PROJECT/payments.git",
]) {
    test("a mismatched remote prevents fetch and PR creation: " + remote, async (t) => {
        const fixture = createFixture(t);
        fixture.remoteFetchUrl.mock.mockImplementation(() => remote);
        await assert.rejects(fixture.run(["develop"]), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /remote does not match/);
            assert.doesNotMatch(error.message + error.stack, /private-user|private-token/);
            return true;
        });
        assert.deepEqual(fixture.events, []);
        assert.equal(fixture.fetch.mock.callCount(), 0);
        assert.equal(fixture.request.mock.callCount(), 0);
        assert.equal(fixture.output.mock.callCount(), 0);
    });
}

for (const namedSource of [false, true]) {
    test(`named target ${namedSource ? "and source avoid" : "uses"} the current branch`, async (t) => {
        const fixture = createFixture(t);
        const args = ["--target-branch", "develop"];
        if (namedSource) args.push("--source-branch", "feature/explicit");
        await fixture.run(args);
        assert.equal(fixture.currentBranch.mock.callCount(), namedSource ? 0 : 1);
        const options = fixture.request.mock.calls[0].arguments[1];
        const body: { fromRef: { id: string } } = JSON.parse(String(options?.body));
        assert.equal(
            body.fromRef.id,
            namedSource ? "refs/heads/feature/explicit" : "refs/heads/feature/current",
        );
    });
}

const reviewerCases = [
    {
        args: ["--reviewer", "anna", "--reviewer", " marco, , giulia "],
        expected: ["anna", "marco", "giulia"],
    },
    { args: ["--no-reviewers"], expected: [] },
];
for (const { args, expected } of reviewerCases) {
    test(`reviewer options ${args.join(" ")} override configured reviewers`, async (t) => {
        const fixture = createFixture(t);
        await fixture.run(["develop", ...args]);
        const options = fixture.request.mock.calls[0].arguments[1];
        const body: { reviewers: { user: { name: string } }[] } = JSON.parse(String(options?.body));
        assert.deepEqual(
            body.reviewers,
            expected.map((name) => ({ user: { name } })),
        );
    });
}

for (const args of [
    ["develop", "--reviewer", "anna", "--no-reviewers"],
    ["develop", "--no-reviewers", "--reviewer", "anna"],
    ["develop", "--reviewer", "", "--no-reviewers"],
]) {
    test(`conflicting reviewer options are rejected before any Git operation: ${JSON.stringify(args)}`, async (t) => {
        const fixture = createFixture(t);
        await assert.rejects(fixture.run(args), { code: "commander.conflictingOption" });
        assert.equal(fixture.currentBranch.mock.callCount(), 0);
        assert.equal(fixture.remoteFetchUrl.mock.callCount(), 0);
        assert.deepEqual(fixture.events, []);
        assert.equal(fixture.request.mock.callCount(), 0);
    });
}

for (const args of [
    [],
    ["develop", "develop"],
    ["feature/test", "--target-branch", "develop"],
    ["--source-branch", "feature/test"],
]) {
    test(`invalid branch arguments prevent remote operations: ${JSON.stringify(args)}`, async (t) => {
        const fixture = createFixture(t);
        await assert.rejects(
            fixture.run(args),
            /Target branch is required|cannot be the same|cannot be combined/,
        );
        assert.deepEqual(fixture.events, []);
        assert.equal(fixture.request.mock.callCount(), 0);
    });
}

for (const missingBranch of ["feature/current", "develop"]) {
    test(`a missing remote branch '${missingBranch}' prevents creating a Pull Request`, async (t) => {
        const fixture = createFixture(t);
        const failure = new Error(`Missing remote branch: ${missingBranch}`);
        fixture.branchExists.mock.mockImplementation((branch) => {
            if (branch === missingBranch) throw failure;
        });
        await assert.rejects(fixture.run(["develop"]), (error: unknown) => error === failure);
        assert.equal(fixture.fetch.mock.callCount(), 1);
        assert.equal(fixture.readCommits.mock.callCount(), 0);
        assert.equal(fixture.request.mock.callCount(), 0);
    });
}

test("a failed fetch stops branch validation and Pull Request creation", async (t) => {
    const fixture = createFixture(t);
    const failure = new Error("Unable to fetch upstream.");
    fixture.fetch.mock.mockImplementation(() => {
        throw failure;
    });
    await assert.rejects(fixture.run(["develop"]), (error: unknown) => error === failure);
    assert.equal(fixture.branchExists.mock.callCount(), 0);
    assert.equal(fixture.readCommits.mock.callCount(), 0);
    assert.equal(fixture.request.mock.callCount(), 0);
});

test("no non-merge commits prevents creation even with an explicit title", async (t) => {
    const fixture = createFixture(t);
    fixture.commits.length = 0;
    await assert.rejects(
        fixture.run(["develop", "--title", "Custom title"]),
        /No commits found between 'refs\/remotes\/upstream\/develop' and 'refs\/remotes\/upstream\/feature\/current'/,
    );
    assert.equal(fixture.request.mock.callCount(), 0);
    assert.equal(fixture.output.mock.callCount(), 0);
});

test("a failed commit read preserves the Git error and prevents Pull Request creation", async (t) => {
    const fixture = createFixture(t);
    const failure = new GitCommandError("Unable to read remote commits.", {
        exitCode: 128,
        args: ["log"],
    });
    fixture.readCommits.mock.mockImplementation(() => {
        throw failure;
    });
    await assert.rejects(fixture.run(["develop"]), (error: unknown) => error === failure);
    assert.equal(fixture.readCommits.mock.callCount(), 1);
    assert.equal(fixture.request.mock.callCount(), 0);
    assert.equal(fixture.output.mock.callCount(), 0);
});

test("Bitbucket errors preserve their structured status and do not print a success URL", async (t) => {
    const fixture = createFixture(t);
    fixture.request.mock.mockImplementation(async () =>
        Response.json(
            {
                errors: [{ message: "A Pull Request already exists." }],
            },
            { status: 409, statusText: "Conflict" },
        ),
    );
    await assert.rejects(fixture.run(["develop"]), (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.method, "POST");
        assert.match(error.message, /A Pull Request already exists/);
        return true;
    });
    assert.equal(fixture.output.mock.callCount(), 0);
});

test("a created Pull Request without a URL reports an explicit error", async (t) => {
    const fixture = createFixture(t);
    fixture.pullRequest.links.self = [];
    await assert.rejects(
        fixture.run(["develop"]),
        /Bitbucket did not provide the created Pull Request URL/,
    );
    assert.equal(fixture.output.mock.callCount(), 0);
});
