import assert from "node:assert/strict";
import { test } from "node:test";

import type { BitbucketPullRequestReviewer } from "../../src/bitbucket/bitbucket-types.ts";
import { buildMergeCommitMessage } from "../../src/pull-request/merge-commit-message.ts";
import { assertPullRequestReview } from "../../src/pull-request/review-validation.ts";
import {
    assertPullRequestCanMerge,
    assertSourceBranchCanBeDeleted,
    assertMergedSourceMatches,
    shouldCompletePullRequestTask,
} from "../../src/pull-request/merge-validation.ts";

function sourceDeletionFixture() {
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    return {
        fromRef: {
            id: "refs/heads/feature/test",
            displayId: "feature/test",
            repository,
            latestCommit: "a".repeat(40),
        },
        toRef: { id: "refs/heads/develop", displayId: "develop", repository },
    };
}

test("source deletion requires a branch and a full commit while allowing fork repositories", () => {
    const pr = sourceDeletionFixture();
    pr.fromRef.repository = { name: "Fork", slug: "fork", project: { key: "~jane" } };
    assert.doesNotThrow(() => assertSourceBranchCanBeDeleted(pr));
});

for (const commit of ["", "abc123", "not-a-commit", "a".repeat(41)]) {
    test("source deletion rejects an invalid commit: " + commit, () => {
        const pr = sourceDeletionFixture();
        pr.fromRef.latestCommit = commit;
        assert.throws(() => assertSourceBranchCanBeDeleted(pr), /full source commit/);
    });
}

test("the target branch cannot be selected for deletion", () => {
    const pr = sourceDeletionFixture();
    pr.fromRef.id = pr.toRef.id;
    assert.throws(() => assertSourceBranchCanBeDeleted(pr), /target branch cannot be deleted/);
});

for (const field of [
    "source ref",
    "source repository",
    "source commit",
    "target ref",
    "target repository",
] as const) {
    test("source deletion requires matching merge metadata: " + field, () => {
        const expected = sourceDeletionFixture();
        const merged = structuredClone(expected);
        if (field === "source ref") merged.fromRef.id = "refs/heads/another";
        if (field === "source repository") merged.fromRef.repository.slug = "another";
        if (field === "source commit") merged.fromRef.latestCommit = "b".repeat(40);
        if (field === "target ref") merged.toRef.id = "refs/heads/another";
        if (field === "target repository") merged.toRef.repository.project.key = "ANOTHER";
        assert.throws(
            () => assertMergedSourceMatches(expected, merged),
            /did not confirm the expected/,
        );
    });
}

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
