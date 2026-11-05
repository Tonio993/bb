import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";
import type { PullRequestIdentity } from "../bitbucket/pull-request-types.ts";
import { getPullRequestMergeability } from "../bitbucket/pull-requests.ts";
import { evaluateMergeChecks } from "../pull-request/merge-checks.ts";
import { showPullRequestView } from "./read-pull-requests.ts";
import type { PullRequestChecks } from "./pull-request-check-types.ts";

export async function checkPullRequest(
    client: Pick<BitbucketApi, "get">,
    identity: PullRequestIdentity,
): Promise<PullRequestChecks> {
    const view = await showPullRequestView(client, identity);
    const server =
        view.pullRequest.state === "OPEN"
            ? await getPullRequestMergeability(client, identity)
            : null;
    const checks = evaluateMergeChecks(view.pullRequest, view.openTasks.length, server);
    return {
        view,
        server,
        checks,
        readyForMerge:
            checks.every((check) => check.status !== "FAIL") &&
            checks.some((check) => check.code === "SERVER_MERGE" && check.status === "PASS"),
    };
}
