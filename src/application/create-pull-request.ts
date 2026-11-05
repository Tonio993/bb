import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";
import type { CreatePullRequestOptions } from "../bitbucket/pull-request-types.ts";
import type { BitbucketPullRequest } from "../bitbucket/bitbucket-types.ts";
import { getOpenPullRequest } from "../bitbucket/pull-request-search.ts";
import { createPullRequest } from "../bitbucket/pull-requests.ts";

export async function createOrFindPullRequest(
    client: Pick<BitbucketApi, "get" | "post">,
    plan: CreatePullRequestOptions,
): Promise<{ pullRequest: BitbucketPullRequest; created: boolean }> {
    const existing = await getOpenPullRequest(client, {
        ...plan,
        sourceRepository: { projectKey: plan.projectKey, repository: plan.repository },
    });
    if (existing) return { pullRequest: existing, created: false };
    return { pullRequest: await createPullRequest(client, plan), created: true };
}
