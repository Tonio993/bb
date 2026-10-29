import assert from "node:assert/strict";
import { test } from "node:test";

import type { BitbucketPullRequestReviewer } from "../src/bitbucket/bitbucket-types.ts";
import { buildMergeCommitMessage } from "../src/pullrequest/merge-commit-message.ts";
import { assertPullRequestReview } from "../src/pullrequest/review-validation.ts";

for (const statuses of [[], ["APPROVED"], ["APPROVED", "UNAPPROVED"]]) {
    test(`review statuses ${JSON.stringify(statuses)} allow merging`, () => {
        assert.doesNotThrow(() => assertPullRequestReview(statuses.map((status) => ({ status }))));
    });
}

test("reviewers require at least one approval", () => {
    assert.throws(() => assertPullRequestReview([{ status: "UNAPPROVED" }]), /no reviewer has approved/);
});

test("a request for changes blocks merging even when another reviewer approved", () => {
    for (const statuses of [["NEEDS_WORK"], ["APPROVED", "NEEDS_WORK"]]) {
        assert.throws(() => assertPullRequestReview(statuses.map((status) => ({ status }))), /reviewer requested changes/);
    }
});

test("missing review data is not treated as a Pull Request without reviewers", () => {
    assert.throws(() => assertPullRequestReview(undefined as unknown as BitbucketPullRequestReviewer[]), /did not provide.*reviewers/);
});

test("merge messages preserve the prefix, suggested subject, and multiline body", () => {
    assert.equal(buildMergeCommitMessage({
        title: "Pull request #42: validate payments",
        body: "Merge feature/payments to develop\n\n* Validate account\n* Check amount",
    }, "[RELEASE] "), "[RELEASE] Pull request #42: validate payments\n\nMerge feature/payments to develop\n\n* Validate account\n* Check amount");
});

test("merge suggestions can contain only a title or only a body", () => {
    assert.equal(buildMergeCommitMessage({ title: "Suggested title" }, "[RELEASE] "), "[RELEASE] Suggested title");
    assert.equal(buildMergeCommitMessage({ title: "  ", body: "Suggested body" }, "[RELEASE] "), "[RELEASE] Suggested body");
});

test("a prefix cannot hide an empty merge message suggestion", () => {
    for (const suggestion of [{}, { title: " ", body: "\r\n" }]) {
        assert.throws(() => buildMergeCommitMessage(suggestion, "[RELEASE] "), /did not provide a merge commit message/);
    }
});
