import type {
    BitbucketPullRequestReviewer,
} from "../bitbucket/bitbucket-types.ts";

export function assertPullRequestReview(
    reviewers: readonly BitbucketPullRequestReviewer[],
): void {
    if (!Array.isArray(reviewers)) {
        throw new Error(
            "Bitbucket did not provide the Pull Request reviewers.",
        );
    }

    if (reviewers.some((reviewer) => reviewer.status === "NEEDS_WORK")) {
        throw new Error(
            "Pull Request cannot be merged because at least one reviewer requested changes.",
        );
    }

    if (
        reviewers.length > 0 &&
        !reviewers.some((reviewer) => reviewer.status === "APPROVED")
    ) {
        throw new Error(
            "Pull Request cannot be merged because no reviewer has approved it.",
        );
    }
}
