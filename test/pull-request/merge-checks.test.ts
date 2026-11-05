import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateMergeChecks } from "../../src/pull-request/merge-checks.ts";
import { assertPullRequestCanMerge } from "../../src/pull-request/merge-validation.ts";
import type { BitbucketMergeability } from "../../src/bitbucket/bitbucket-types.ts";

const clean: BitbucketMergeability = {
    canMerge: true,
    conflicted: false,
    outcome: "CLEAN",
    vetoes: [],
};
for (const reviewers of [
    [],
    [{ status: "APPROVED" }],
    [{ status: "UNAPPROVED" }],
    [{ status: "APPROVED" }, { status: "NEEDS_WORK" }],
]) {
    test(
        "preflight reviewer decisions match the merge workflow: " + JSON.stringify(reviewers),
        () => {
            const pr = { state: "OPEN", version: 0, reviewers };
            const checks = evaluateMergeChecks(pr, 0, clean);
            const failed = checks.some((check) => check.status === "FAIL");
            if (failed) assert.throws(() => assertPullRequestCanMerge(pr));
            else assert.doesNotThrow(() => assertPullRequestCanMerge(pr));
        },
    );
}
test("task warnings do not introduce a new local merge restriction", () => {
    const checks = evaluateMergeChecks({ state: "OPEN", version: 0, reviewers: [] }, 2, clean);
    assert.equal(checks.find((check) => check.code === "TASKS")?.status, "WARN");
    assert.ok(checks.every((check) => check.status !== "FAIL"));
});
for (const server of [
    { ...clean, canMerge: false },
    { ...clean, conflicted: true },
    { ...clean, vetoes: [{ summaryMessage: "Build failed" }] },
    { ...clean, outcome: "UNKNOWN" },
    { ...clean, outcome: "CONFLICTED" },
]) {
    test("a server blocker cannot be overridden: " + JSON.stringify(server), () => {
        const checks = evaluateMergeChecks({ state: "OPEN", version: 0, reviewers: [] }, 0, server);
        assert.equal(checks.find((check) => check.code === "SERVER_MERGE")?.status, "FAIL");
    });
}
test("closed state, missing version and skipped server remain explicit", () => {
    const checks = evaluateMergeChecks({ state: "MERGED", version: -1, reviewers: [] }, 0, null);
    assert.equal(checks.find((check) => check.code === "PR_OPEN")?.status, "FAIL");
    assert.equal(checks.find((check) => check.code === "PR_VERSION")?.status, "FAIL");
    assert.equal(checks.find((check) => check.code === "SERVER_MERGE")?.status, "SKIP");
});
