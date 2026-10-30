import type { BitbucketPullRequest, BitbucketPullRequestTask } from "../bitbucket/bitbucket-types.ts";
import { assertPullRequestReview } from "./review-validation.ts";

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
        task.state !== "OPEN" || task.severity !== "BLOCKER" ||
        !Number.isInteger(task.version) || task.version < 0
    ) {
        throw new Error(`Bitbucket did not provide valid details for Pull Request task #${task.id}.`);
    }
    return true;
}
