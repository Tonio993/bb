import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePullRequestBranches } from "../src/pullrequest/branches.ts";
import { buildPullRequestContent } from "../src/pullrequest/pull-request-content.ts";
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

test("a single commit supplies the title while its description remains a Markdown list", () => {
    assert.deepEqual(buildPullRequestContent([
        { subject: "Implement payment validation", body: "" },
    ], "feature/ABC-123"), {
        title: "Implement payment validation",
        description: "* Implement payment validation",
    });
});

test("multiple commits preserve their order, nested body lines, and Markdown separators", () => {
    assert.deepEqual(buildPullRequestContent([
        { subject: "Add validation", body: " First detail\r\n\r\nSecond detail \r\n" },
        { subject: "Add coverage", body: "" },
    ], "feature/ABC-123"), {
        title: "feature/ABC-123",
        description: "* Add validation\n    * First detail\n    * Second detail\n\n&nbsp;\n\n* Add coverage",
    });
});

test("content generation requires at least one commit", () => {
    assert.throws(() => buildPullRequestContent([], "feature/ABC-123"), /without commits/);
});

test("a single commit retains its nested body while ignoring blank lines", () => {
    assert.deepEqual(buildPullRequestContent([
        { subject: "Validate payments", body: "\n First detail\n \nSecond detail \n" },
    ], "feature/ABC-123"), {
        title: "Validate payments",
        description: "* Validate payments\n    * First detail\n    * Second detail",
    });
});

test("content generation accepts immutable commits and preserves Unicode and input order", () => {
    const commits = Object.freeze([
        Object.freeze({ subject: "Validate € amounts", body: "Handle café payments" }),
        Object.freeze({ subject: "Add 日本語 coverage", body: "" }),
    ]);
    assert.deepEqual(buildPullRequestContent(commits, "feature/ABC-123"), {
        title: "feature/ABC-123",
        description: "* Validate € amounts\n    * Handle café payments\n\n&nbsp;\n\n* Add 日本語 coverage",
    });
});
