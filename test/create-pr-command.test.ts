import assert from "node:assert/strict";
import { Command } from "commander";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { BitbucketApiError } from "../src/bitbucket/bitbucket-api-error.ts";
import { BitbucketClient } from "../src/bitbucket/bitbucket-client.ts";
import type { BitbucketPullRequest } from "../src/bitbucket/bitbucket-types.ts";
import type { CommandContext } from "../src/cli/command-context.ts";
import { registerCreatePrCommand } from "../src/commands/create-pr-command.ts";
import type { BbConfig } from "../src/config/config.ts";
import { GitClient } from "../src/git/git-client.ts";
import type { GitCommit } from "../src/git/git-client.ts";

function createFixture(t: TestContext) {
    const config: BbConfig = {
        bitbucket: {
            url: "https://bitbucket.example/bitbucket",
            projectKey: "PROJECT",
            defaultReviewers: ["mario", "luca"],
        },
        git: { remote: "upstream" },
    };
    const events: string[] = [];
    const git = new GitClient("upstream", () => { throw new Error("Git must be mocked."); });
    const currentBranch = t.mock.method(git, "currentBranch", () => "feature/current");
    const currentRepository = t.mock.method(git, "currentRepository", () => "payments");
    const fetch = t.mock.method(git, "fetch", () => { events.push("fetch"); });
    const branchExists = t.mock.method(git, "remoteBranchExists", (branch: string) => {
        events.push(`branch:${branch}`);
        return true;
    });
    const commits: GitCommit[] = [{ subject: "Validate payments", body: "Check account\nReject invalid amounts" }];
    const readCommits = t.mock.method(git, "commitsBetween", () => {
        events.push("commits");
        return commits;
    });
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    const pullRequest: BitbucketPullRequest = {
        id: 42, version: 0, state: "OPEN", reviewers: [],
        fromRef: { id: "refs/heads/feature/current", displayId: "feature/current", repository },
        toRef: { id: "refs/heads/develop", displayId: "develop", repository },
        links: { self: [{ href: "https://bitbucket.example/bitbucket/projects/PROJECT/repos/payments/pull-requests/42" }] },
    };
    const request = t.mock.method(globalThis, "fetch", async () => {
        events.push("create");
        return Response.json(pullRequest, { status: 201 });
    });
    const output = t.mock.method(console, "log", () => {});
    const context: CommandContext = {
        config,
        gitClient: git,
        bitbucketClient: new BitbucketClient(config.bitbucket, () => "test-token"),
        get configStore(): never { throw new Error("Configuration is already loaded."); },
    };
    const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
    registerCreatePrCommand(program, context);

    return {
        config, events, currentBranch, currentRepository, fetch, branchExists, readCommits,
        commits, pullRequest, request, output,
        run: (args: string[]) => program.parseAsync(["create-pr", ...args], { from: "user" }),
    };
}

test("create-pr fetches and validates remote branches before generating content and posting the Pull Request", async (t) => {
    const fixture = createFixture(t);
    await fixture.run(["develop"]);

    assert.deepEqual(fixture.events, ["fetch", "branch:feature/current", "branch:develop", "commits", "create"]);
    assert.equal(fixture.currentBranch.mock.callCount(), 1);
    assert.deepEqual(fixture.fetch.mock.calls[0].arguments, ["upstream"]);
    assert.deepEqual(fixture.branchExists.mock.calls.map(({ arguments: args }) => args), [
        ["feature/current", "upstream"], ["develop", "upstream"],
    ]);
    assert.deepEqual(fixture.readCommits.mock.calls[0].arguments, [
        "refs/remotes/upstream/develop", "refs/remotes/upstream/feature/current",
    ]);
    assert.equal(fixture.request.mock.callCount(), 1);
    const [url, options] = fixture.request.mock.calls[0].arguments;
    assert.equal(url, "https://bitbucket.example/bitbucket/rest/api/latest/projects/PROJECT/repos/payments/pull-requests");
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
    assert.deepEqual(fixture.output.mock.calls.map(({ arguments: args }) => args), [[fixture.pullRequest.links.self[0].href]]);
});

test("explicit branches avoid querying the current branch and allow title and project overrides", async (t) => {
    const fixture = createFixture(t);
    fixture.currentRepository.mock.mockImplementation(() => "payments & accounts");
    await fixture.run(["feature/explicit", "main", "--title", " Custom title ", "--project-key", " OTHER PROJECT "]);
    assert.equal(fixture.currentBranch.mock.callCount(), 0);
    assert.deepEqual(fixture.readCommits.mock.calls[0].arguments, [
        "refs/remotes/upstream/main", "refs/remotes/upstream/feature/explicit",
    ]);
    const [url, options] = fixture.request.mock.calls[0].arguments;
    assert.equal(url, "https://bitbucket.example/bitbucket/rest/api/latest/projects/OTHER%20PROJECT/repos/payments%20%26%20accounts/pull-requests");
    const body: { title: string } = JSON.parse(String(options?.body));
    assert.equal(body.title, "Custom title");
});

for (const namedSource of [false, true]) {
    test(`named target ${namedSource ? "and source avoid" : "uses"} the current branch`, async (t) => {
        const fixture = createFixture(t);
        const args = ["--target-branch", "develop"];
        if (namedSource) args.push("--source-branch", "feature/explicit");
        await fixture.run(args);
        assert.equal(fixture.currentBranch.mock.callCount(), namedSource ? 0 : 1);
        const options = fixture.request.mock.calls[0].arguments[1];
        const body: { fromRef: { id: string } } = JSON.parse(String(options?.body));
        assert.equal(body.fromRef.id, namedSource ? "refs/heads/feature/explicit" : "refs/heads/feature/current");
    });
}

const reviewerCases = [
    { args: ["--reviewer", "anna", "--reviewer", " marco, , giulia "], expected: ["anna", "marco", "giulia"] },
    { args: ["--no-reviewers"], expected: [] },
];
for (const { args, expected } of reviewerCases) {
    test(`reviewer options ${args.join(" ")} override configured reviewers`, async (t) => {
        const fixture = createFixture(t);
        await fixture.run(["develop", ...args]);
        const options = fixture.request.mock.calls[0].arguments[1];
        const body: { reviewers: { user: { name: string } }[] } = JSON.parse(String(options?.body));
        assert.deepEqual(body.reviewers, expected.map((name) => ({ user: { name } })));
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
        assert.equal(fixture.currentRepository.mock.callCount(), 0);
        assert.deepEqual(fixture.events, []);
        assert.equal(fixture.request.mock.callCount(), 0);
    });
}

for (const args of [[], ["develop", "develop"], ["feature/test", "--target-branch", "develop"], ["--source-branch", "feature/test"]]) {
    test(`invalid branch arguments prevent remote operations: ${JSON.stringify(args)}`, async (t) => {
        const fixture = createFixture(t);
        await assert.rejects(fixture.run(args), /Target branch is required|cannot be the same|cannot be combined/);
        assert.deepEqual(fixture.events, []);
        assert.equal(fixture.request.mock.callCount(), 0);
    });
}

for (const missingBranch of ["feature/current", "develop"]) {
    test(`a missing remote branch '${missingBranch}' prevents creating a Pull Request`, async (t) => {
        const fixture = createFixture(t);
        fixture.branchExists.mock.mockImplementation((branch: string) => branch !== missingBranch);
        await assert.rejects(fixture.run(["develop"]), /Remote (source|target) branch .* does not exist/);
        assert.equal(fixture.fetch.mock.callCount(), 1);
        assert.equal(fixture.readCommits.mock.callCount(), 0);
        assert.equal(fixture.request.mock.callCount(), 0);
    });
}

test("a failed fetch stops branch validation and Pull Request creation", async (t) => {
    const fixture = createFixture(t);
    const failure = new Error("Unable to fetch upstream.");
    fixture.fetch.mock.mockImplementation(() => { throw failure; });
    await assert.rejects(fixture.run(["develop"]), (error: unknown) => error === failure);
    assert.equal(fixture.branchExists.mock.callCount(), 0);
    assert.equal(fixture.readCommits.mock.callCount(), 0);
    assert.equal(fixture.request.mock.callCount(), 0);
});

test("no non-merge commits prevents creation even with an explicit title", async (t) => {
    const fixture = createFixture(t);
    fixture.commits.length = 0;
    await assert.rejects(fixture.run(["develop", "--title", "Custom title"]), /No commits found between/);
    assert.equal(fixture.request.mock.callCount(), 0);
    assert.equal(fixture.output.mock.callCount(), 0);
});

test("Bitbucket errors preserve their structured status and do not print a success URL", async (t) => {
    const fixture = createFixture(t);
    fixture.request.mock.mockImplementation(async () => Response.json({
        errors: [{ message: "A Pull Request already exists." }],
    }, { status: 409, statusText: "Conflict" }));
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
    await assert.rejects(fixture.run(["develop"]), /Bitbucket did not provide the created Pull Request URL/);
    assert.equal(fixture.output.mock.callCount(), 0);
});
