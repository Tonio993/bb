import assert from "node:assert/strict";
import { test } from "node:test";

import type { BitbucketPullRequestReviewer } from "../src/bitbucket/bitbucket-types.ts";
import { buildMergeCommitMessage } from "../src/pullrequest/merge-commit-message.ts";
import { assertPullRequestReview } from "../src/pullrequest/review-validation.ts";
import {
    assertPullRequestCanMerge,
    shouldCompletePullRequestTask,
} from "../src/pullrequest/merge-validation.ts";

for (const statuses of [[], ["APPROVED"], ["APPROVED", "UNAPPROVED"]]) {
    test(`review statuses ${JSON.stringify(statuses)} allow merging`, () => {
        assert.doesNotThrow(() => assertPullRequestReview(statuses.map((status) => ({ status }))));
    });
}

test("reviewers require at least one approval", () => {
    assert.throws(
        () => assertPullRequestReview([{ status: "UNAPPROVED" }]),
        /no reviewer has approved/,
    );
});

test("a request for changes blocks merging even when another reviewer approved", () => {
    for (const statuses of [["NEEDS_WORK"], ["APPROVED", "NEEDS_WORK"]]) {
        assert.throws(
            () => assertPullRequestReview(statuses.map((status) => ({ status }))),
            /reviewer requested changes/,
        );
    }
});

test("missing review data is not treated as a Pull Request without reviewers", () => {
    assert.throws(
        () => assertPullRequestReview(undefined as unknown as BitbucketPullRequestReviewer[]),
        /did not provide.*reviewers/,
    );
});

test("merge messages preserve the prefix, suggested subject, and multiline body", () => {
    assert.equal(
        buildMergeCommitMessage(
            {
                title: "Pull request #42: validate payments",
                body: "Merge feature/payments to develop\n\n* Validate account\n* Check amount",
            },
            "[RELEASE] ",
        ),
        "[RELEASE] Pull request #42: validate payments\n\nMerge feature/payments to develop\n\n* Validate account\n* Check amount",
    );
});

test("merge suggestions can contain only a title or only a body", () => {
    assert.equal(
        buildMergeCommitMessage({ title: "Suggested title" }, "[RELEASE] "),
        "[RELEASE] Suggested title",
    );
    assert.equal(
        buildMergeCommitMessage({ title: "  ", body: "Suggested body" }, "[RELEASE] "),
        "[RELEASE] Suggested body",
    );
});

test("a prefix cannot hide an empty merge message suggestion", () => {
    for (const suggestion of [{}, { title: " ", body: "\r\n" }]) {
        assert.throws(
            () => buildMergeCommitMessage(suggestion, "[RELEASE] "),
            /did not provide a merge commit message/,
        );
    }
});

test("an open Pull Request with version zero can merge without reviewers", () => {
    assert.doesNotThrow(() =>
        assertPullRequestCanMerge({ state: "OPEN", version: 0, reviewers: [] }),
    );
});

for (const state of ["MERGED", "DECLINED"]) {
    test(`a ${state} Pull Request cannot merge`, () => {
        assert.throws(
            () => assertPullRequestCanMerge({ state, version: 1, reviewers: [] }),
            /Only open Pull Requests/,
        );
    });
}

for (const version of [-1, 0.5, Number.NaN]) {
    test(`merge validation rejects version ${version}`, () => {
        assert.throws(
            () => assertPullRequestCanMerge({ state: "OPEN", version, reviewers: [] }),
            /Pull Request version/,
        );
    });
}

test("merge eligibility includes the reviewer policy", () => {
    assert.throws(
        () =>
            assertPullRequestCanMerge({
                state: "OPEN",
                version: 1,
                reviewers: [{ status: "APPROVED" }, { status: "NEEDS_WORK" }],
            }),
        /reviewer requested changes/,
    );
});

test("task completion uses only open blockers and skips resolved or ordinary comments", () => {
    assert.equal(
        shouldCompletePullRequestTask({ id: 101, version: 0, state: "OPEN", severity: "BLOCKER" }),
        true,
    );
    assert.equal(
        shouldCompletePullRequestTask({
            id: 101,
            version: 1,
            state: "RESOLVED",
            severity: "BLOCKER",
        }),
        false,
    );
    assert.equal(
        shouldCompletePullRequestTask({ id: 101, version: 1, state: "OPEN", severity: "NORMAL" }),
        false,
    );
});

for (const task of [
    { id: 101, version: -1, state: "OPEN", severity: "BLOCKER" },
    { id: 101, version: 0.5, state: "OPEN", severity: "BLOCKER" },
    { id: 101, version: 1, state: "UNKNOWN", severity: "BLOCKER" },
    { id: 101, version: 1, state: "OPEN", severity: "UNKNOWN" },
]) {
    test(`task completion rejects invalid details ${JSON.stringify(task)}`, () => {
        assert.throws(() => shouldCompletePullRequestTask(task), /valid details.*#101/);
    });
}
