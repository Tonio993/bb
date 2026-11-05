import type { BitbucketMergeability, BitbucketPullRequest } from "../bitbucket/bitbucket-types.ts";
import { assertPullRequestReview } from "./review-validation.ts";
import type { MergeCheck } from "./merge-check-types.ts";

export function evaluateMergeChecks(
    pr: Pick<BitbucketPullRequest, "state" | "version" | "reviewers">,
    openTaskCount: number,
    server: BitbucketMergeability | null,
): MergeCheck[] {
    const checks: MergeCheck[] = [
        {
            code: "PR_OPEN",
            status: pr.state === "OPEN" ? "PASS" : "FAIL",
            message:
                pr.state === "OPEN"
                    ? "Pull Request is open."
                    : "Only open Pull Requests can be merged.",
        },
        {
            code: "PR_VERSION",
            status: Number.isSafeInteger(pr.version) && pr.version >= 0 ? "PASS" : "FAIL",
            message:
                Number.isSafeInteger(pr.version) && pr.version >= 0
                    ? "Pull Request version is available."
                    : "Unable to determine the Pull Request version.",
        },
    ];
    try {
        assertPullRequestReview(pr.reviewers);
        checks.push({
            code: "REVIEWERS",
            status: "PASS",
            message: "Local reviewer requirements are satisfied.",
        });
    } catch (error) {
        checks.push({
            code: "REVIEWERS",
            status: "FAIL",
            message:
                error instanceof Error
                    ? error.message
                    : "Unable to validate Pull Request reviewers.",
        });
    }
    checks.push({
        code: "TASKS",
        status: openTaskCount ? "WARN" : "PASS",
        message: openTaskCount
            ? String(openTaskCount) +
              " open task(s). Server policy determines whether they block merging."
            : "No open tasks.",
    });
    const serverReady =
        server !== null &&
        server.canMerge &&
        !server.conflicted &&
        server.vetoes.length === 0 &&
        (server.outcome === undefined || server.outcome === "CLEAN");
    checks.push({
        code: "SERVER_MERGE",
        status: server === null ? "SKIP" : serverReady ? "PASS" : "FAIL",
        message:
            server === null
                ? "Server mergeability was not requested because the Pull Request is not open."
                : serverReady
                  ? "Bitbucket reports no merge blockers."
                  : "Bitbucket reports merge blockers or an outcome that is not clean.",
    });
    return checks;
}
