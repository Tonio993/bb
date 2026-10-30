import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePullRequestBranches } from "../../src/pull-request/branches.ts";

test("one positional branch is the target and resolves the current branch once", (t) => {
    const currentBranch = t.mock.fn(() => "feature/ABC-123");
    assert.deepEqual(resolvePullRequestBranches("develop", undefined, currentBranch), {
        sourceBranch: "feature/ABC-123",
        targetBranch: "develop",
    });
    assert.equal(currentBranch.mock.callCount(), 1);
});

test("two explicit branches do not query the current branch", (t) => {
    const currentBranch = t.mock.fn(() => {
        throw new Error("Current branch is unnecessary.");
    });
    assert.deepEqual(resolvePullRequestBranches("feature/ABC-123", "develop", currentBranch), {
        sourceBranch: "feature/ABC-123",
        targetBranch: "develop",
    });
    assert.equal(currentBranch.mock.callCount(), 0);
});

test("a named target uses the current branch and two named branches avoid querying it", (t) => {
    const currentBranch = t.mock.fn(() => "feature/current");
    assert.deepEqual(
        resolvePullRequestBranches(undefined, undefined, currentBranch, {
            targetBranch: "develop",
        }),
        { sourceBranch: "feature/current", targetBranch: "develop" },
    );
    assert.equal(currentBranch.mock.callCount(), 1);

    assert.deepEqual(
        resolvePullRequestBranches(undefined, undefined, currentBranch, {
            sourceBranch: "feature/explicit",
            targetBranch: "main",
        }),
        { sourceBranch: "feature/explicit", targetBranch: "main" },
    );
    assert.equal(currentBranch.mock.callCount(), 1);
});

test("missing targets and mixed branch arguments fail before querying Git", (t) => {
    const currentBranch = t.mock.fn(() => {
        throw new Error("Git must not be queried.");
    });
    assert.throws(
        () => resolvePullRequestBranches(undefined, undefined, currentBranch),
        /Target branch is required/,
    );
    assert.throws(
        () =>
            resolvePullRequestBranches(undefined, undefined, currentBranch, {
                sourceBranch: "feature/ABC-123",
            }),
        /Target branch is required/,
    );
    assert.throws(
        () =>
            resolvePullRequestBranches("develop", undefined, currentBranch, {
                targetBranch: "main",
            }),
        /Positional branch arguments cannot be combined/,
    );
    assert.throws(
        () =>
            resolvePullRequestBranches("feature/ABC-123", "develop", currentBranch, {
                sourceBranch: "feature/other",
            }),
        /Positional branch arguments cannot be combined/,
    );
    assert.equal(currentBranch.mock.callCount(), 0);
});

test("identical branches are rejected for explicit and inferred sources", () => {
    assert.throws(
        () => resolvePullRequestBranches("develop", "develop", () => "unused"),
        /cannot be the same/,
    );
    assert.throws(
        () => resolvePullRequestBranches("develop", undefined, () => "develop"),
        /cannot be the same/,
    );
    assert.throws(
        () =>
            resolvePullRequestBranches(undefined, undefined, () => "unused", {
                sourceBranch: "develop",
                targetBranch: "develop",
            }),
        /cannot be the same/,
    );
});
