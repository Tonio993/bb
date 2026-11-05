import type {
    BitbucketPullRequest,
    BitbucketPullRequestTask,
    BitbucketPullRequestRef,
} from "../bitbucket/bitbucket-types.ts";
import { assertPullRequestReview } from "./review-validation.ts";

type PullRequestBranches = Pick<BitbucketPullRequest, "fromRef" | "toRef">;
type PullRequestWithSourceCommit = PullRequestBranches & {
    fromRef: BitbucketPullRequestRef & { latestCommit: string };
};

export function assertSourceBranchCanBeDeleted(
    pullRequest: PullRequestBranches,
): asserts pullRequest is PullRequestWithSourceCommit {
    const source = pullRequest.fromRef;
    if (!source.id.startsWith("refs/heads/") || source.id === "refs/heads/") {
        throw new Error("Bitbucket did not provide a valid source branch ref for deletion.");
    }
    if (!source.latestCommit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(source.latestCommit)) {
        throw new Error("Bitbucket did not provide a full source commit for safe branch deletion.");
    }
    if (!source.repository.project.key.trim() || !source.repository.slug.trim()) {
        throw new Error("Bitbucket did not provide the source repository for branch deletion.");
    }
    if (sameBranch(source, pullRequest.toRef)) {
        throw new Error("The target branch cannot be deleted as the source branch.");
    }
}

export function assertMergedSourceMatches(
    expected: PullRequestBranches,
    merged: PullRequestBranches,
): void {
    if (
        !hasSamePullRequestBranches(expected, merged) ||
        !merged.fromRef.latestCommit ||
        expected.fromRef.latestCommit?.toLowerCase() !== merged.fromRef.latestCommit.toLowerCase()
    ) {
        throw new Error(
            "Bitbucket did not confirm the expected merged source branch and commit. Source branch deletion was skipped.",
        );
    }
}

export function hasSamePullRequestBranches(
    left: PullRequestBranches,
    right: PullRequestBranches,
): boolean {
    return sameBranch(left.fromRef, right.fromRef) && sameBranch(left.toRef, right.toRef);
}

function sameBranch(left: BitbucketPullRequestRef, right: BitbucketPullRequestRef): boolean {
    return (
        left.id === right.id &&
        left.repository.project.key === right.repository.project.key &&
        left.repository.slug === right.repository.slug
    );
}

export function assertPullRequestCanMerge(
    pullRequest: Pick<BitbucketPullRequest, "state" | "version" | "reviewers">,
): void {
    if (pullRequest.state !== "OPEN") {
        throw new Error("Only open Pull Requests can be merged.");
    }
    if (!Number.isInteger(pullRequest.version) || pullRequest.version < 0) {
        throw new Error("Unable to determine the Pull Request version.");
    }
    assertPullRequestReview(pullRequest.reviewers);
}

export function shouldCompletePullRequestTask(task: BitbucketPullRequestTask): boolean {
    if (task.state === "RESOLVED" || task.severity === "NORMAL") return false;
    if (
        task.state !== "OPEN" ||
        task.severity !== "BLOCKER" ||
        !Number.isInteger(task.version) ||
        task.version < 0
    ) {
        throw new Error(
            `Bitbucket did not provide valid details for Pull Request task #${task.id}.`,
        );
    }
    return true;
}
