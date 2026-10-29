import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { GitClient } from "../src/git/git-client.ts";
import type { GitCommit } from "../src/git/git-client.ts";
import { resolvePullRequestBranches } from "../src/pullrequest/branches.ts";
import { getPullRequestContent } from "../src/pullrequest/pull-request-content.ts";
import { resolvePullRequestReviewers } from "../src/pullrequest/reviewers.ts";

test("one positional branch is the target and resolves the current branch once", (t) => {
    const currentBranch = t.mock.fn(() => "feature/ABC-123");
    assert.deepEqual(resolvePullRequestBranches("develop", undefined, currentBranch), {
        sourceBranch: "feature/ABC-123",
        targetBranch: "develop",
    });
    assert.equal(currentBranch.mock.callCount(), 1);
});

test("two explicit branches do not query the current branch", (t) => {
    const currentBranch = t.mock.fn(() => { throw new Error("Current branch is unnecessary."); });
    assert.deepEqual(resolvePullRequestBranches("feature/ABC-123", "develop", currentBranch), {
        sourceBranch: "feature/ABC-123", targetBranch: "develop",
    });
    assert.equal(currentBranch.mock.callCount(), 0);
});

test("a named target uses the current branch and two named branches avoid querying it", (t) => {
    const currentBranch = t.mock.fn(() => "feature/current");
    assert.deepEqual(resolvePullRequestBranches(undefined, undefined, currentBranch, {
        targetBranch: "develop",
    }), { sourceBranch: "feature/current", targetBranch: "develop" });
    assert.equal(currentBranch.mock.callCount(), 1);

    assert.deepEqual(resolvePullRequestBranches(undefined, undefined, currentBranch, {
        sourceBranch: "feature/explicit", targetBranch: "main",
    }), { sourceBranch: "feature/explicit", targetBranch: "main" });
    assert.equal(currentBranch.mock.callCount(), 1);
});

test("missing targets and mixed branch arguments fail before querying Git", (t) => {
    const currentBranch = t.mock.fn(() => { throw new Error("Git must not be queried."); });
    assert.throws(() => resolvePullRequestBranches(undefined, undefined, currentBranch), /Target branch is required/);
    assert.throws(() => resolvePullRequestBranches(undefined, undefined, currentBranch, {
        sourceBranch: "feature/ABC-123",
    }), /Target branch is required/);
    assert.throws(() => resolvePullRequestBranches("develop", undefined, currentBranch, {
        targetBranch: "main",
    }), /Positional branch arguments cannot be combined/);
    assert.throws(() => resolvePullRequestBranches("feature/ABC-123", "develop", currentBranch, {
        sourceBranch: "feature/other",
    }), /Positional branch arguments cannot be combined/);
    assert.equal(currentBranch.mock.callCount(), 0);
});

test("identical branches are rejected for explicit and inferred sources", () => {
    assert.throws(() => resolvePullRequestBranches("develop", "develop", () => "unused"), /cannot be the same/);
    assert.throws(() => resolvePullRequestBranches("develop", undefined, () => "develop"), /cannot be the same/);
    assert.throws(() => resolvePullRequestBranches(undefined, undefined, () => "unused", {
        sourceBranch: "develop", targetBranch: "develop",
    }), /cannot be the same/);
});

test("reviewers use defaults, explicit overrides, or no reviewers", () => {
    const defaults = [" mario ", "", "luca"];
    assert.deepEqual(resolvePullRequestReviewers([], false, defaults), ["mario", "luca"]);
    assert.deepEqual(resolvePullRequestReviewers([" anna ", " "], false, defaults), ["anna"]);
    assert.deepEqual(resolvePullRequestReviewers([], true, defaults), []);
    assert.deepEqual(defaults, [" mario ", "", "luca"]);
    assert.throws(() => resolvePullRequestReviewers(["anna"], true, defaults), /cannot be used together/);
});

function contentFixture(t: TestContext, commits: GitCommit[]) {
    const git = new GitClient("upstream", () => {
        throw new Error("Reading commit content must not request a token.");
    });
    const readCommits = t.mock.method(git, "commitsBetween", () => commits);
    return {
        readCommits,
        content: () => getPullRequestContent(git, "feature/ABC-123", "develop", "upstream"),
    };
}

test("a single commit supplies the title while its description remains a Markdown list", (t) => {
    const fixture = contentFixture(t, [{ subject: "Implement payment validation", body: "" }]);
    assert.deepEqual(fixture.content(), {
        title: "Implement payment validation",
        description: "* Implement payment validation",
    });
    assert.deepEqual(fixture.readCommits.mock.calls[0].arguments, [
        "refs/remotes/upstream/develop", "refs/remotes/upstream/feature/ABC-123",
    ]);
});

test("multiple commits preserve their order, nested body lines, and Markdown separators", (t) => {
    const fixture = contentFixture(t, [
        { subject: "Add validation", body: " First detail\r\n\r\nSecond detail \r\n" },
        { subject: "Add coverage", body: "" },
    ]);
    assert.deepEqual(fixture.content(), {
        title: "feature/ABC-123",
        description: "* Add validation\n    * First detail\n    * Second detail\n\n&nbsp;\n\n* Add coverage",
    });
});

test("no commits prevents creating an empty Pull Request", (t) => {
    const fixture = contentFixture(t, []);
    assert.throws(fixture.content, /No commits found between 'refs\/remotes\/upstream\/develop' and 'refs\/remotes\/upstream\/feature\/ABC-123'/);
});
