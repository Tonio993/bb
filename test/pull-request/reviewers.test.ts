import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePullRequestReviewers } from "../../src/pull-request/reviewers.ts";

test("reviewers use defaults, explicit overrides, or no reviewers", () => {
    const defaults = [" mario ", "", "luca"];
    assert.deepEqual(resolvePullRequestReviewers([], false, defaults), ["mario", "luca"]);
    assert.deepEqual(resolvePullRequestReviewers([" anna ", " "], false, defaults), ["anna"]);
    assert.deepEqual(resolvePullRequestReviewers([], true, defaults), []);
    assert.deepEqual(defaults, [" mario ", "", "luca"]);
    assert.throws(
        () => resolvePullRequestReviewers(["anna"], true, defaults),
        /cannot be used together/,
    );
});
