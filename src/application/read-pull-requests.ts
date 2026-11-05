import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";
import { listRepositoryPullRequests } from "../bitbucket/pull-request-search.ts";
import { getPullRequestDetails } from "../bitbucket/pull-requests.ts";
import { getPullRequestTasks } from "../bitbucket/pull-request-tasks.ts";
import type {
    ListRepositoryPullRequestsOptions,
    PullRequestIdentity,
} from "../bitbucket/pull-request-types.ts";
import type { BitbucketPullRequestDetails } from "../bitbucket/bitbucket-types.ts";
import type { PullRequestView } from "./pull-request-view-types.ts";

export async function listPullRequestViews(
    client: Pick<BitbucketApi, "get">,
    options: ListRepositoryPullRequestsOptions,
): Promise<PullRequestView[]> {
    const prs = await listRepositoryPullRequests(client, options);
    const results: PullRequestView[] = [];
    for (const pr of prs)
        results.push(await loadView(client, pr, { ...options, pullRequestId: pr.id }));
    return results;
}

export async function showPullRequestView(
    client: Pick<BitbucketApi, "get">,
    identity: PullRequestIdentity,
): Promise<PullRequestView> {
    const pr = await getPullRequestDetails(client, identity);
    return loadView(client, pr, identity);
}

async function loadView(
    client: Pick<BitbucketApi, "get">,
    pr: BitbucketPullRequestDetails,
    identity: PullRequestIdentity,
): Promise<PullRequestView> {
    if (
        pr.id !== identity.pullRequestId ||
        pr.toRef.repository.project.key.toLowerCase() !== identity.projectKey.toLowerCase() ||
        pr.toRef.repository.slug.toLowerCase() !== identity.repository.toLowerCase()
    ) {
        throw new Error("Bitbucket returned a different Pull Request identity.");
    }
    const tasks = await getPullRequestTasks(client, identity);
    return {
        pullRequest: pr,
        openTasks: tasks.filter((task) => task.state === "OPEN" && task.severity === "BLOCKER"),
    };
}
