import type { BitbucketApi } from "./bitbucket-client.ts";
import type {
    BitbucketCommitMessageSuggestion,
    BitbucketPullRequest,
    BitbucketPullRequestDetails,
} from "./bitbucket-types.ts";
import type {
    CreatePullRequestOptions,
    PullRequestIdentity,
    MergePullRequestBody,
} from "./pull-request-types.ts";
import {
    parseCommitMessageSuggestion,
    parsePullRequest,
    parsePullRequestDetails,
} from "./response-parsers.ts";

export async function getPullRequestDetails(
    client: Pick<BitbucketApi, "get">,
    identity: PullRequestIdentity,
): Promise<BitbucketPullRequestDetails> {
    return client.get(getPullRequestPath(identity), parsePullRequestDetails);
}

export async function createPullRequest(
    client: Pick<BitbucketApi, "post">,
    options: CreatePullRequestOptions,
): Promise<BitbucketPullRequest> {
    const encodedProjectKey = encodeURIComponent(options.projectKey);

    const encodedRepository = encodeURIComponent(options.repository);

    const path =
        `rest/api/latest/projects/${encodedProjectKey}` +
        `/repos/${encodedRepository}` +
        `/pull-requests`;

    const body = {
        title: options.title,

        description: options.description,

        fromRef: {
            id: `refs/heads/${options.sourceBranch}`,
        },

        toRef: {
            id: `refs/heads/${options.targetBranch}`,
        },

        reviewers: options.reviewers.map((reviewer) => ({
            user: {
                name: reviewer,
            },
        })),
    };

    return client.post(path, body, parsePullRequest);
}

export async function getPullRequest(
    client: Pick<BitbucketApi, "get">,
    identity: PullRequestIdentity,
): Promise<BitbucketPullRequest> {
    return client.get(getPullRequestPath(identity), parsePullRequest);
}

export async function mergePullRequest(
    client: Pick<BitbucketApi, "post">,
    identity: PullRequestIdentity,
    body: MergePullRequestBody,
): Promise<BitbucketPullRequest> {
    return client.post(`${getPullRequestPath(identity)}/merge`, body, parsePullRequest);
}

export async function getPullRequestCommitMessageSuggestion(
    client: Pick<BitbucketApi, "get">,
    identity: PullRequestIdentity,
): Promise<BitbucketCommitMessageSuggestion> {
    return client.get(
        `${getPullRequestPath(identity)}/commit-message-suggestion`,
        parseCommitMessageSuggestion,
    );
}

export function getPullRequestPath(identity: PullRequestIdentity): string {
    if (!identity.projectKey?.trim()) {
        throw new Error("Unable to determine the Pull Request project.");
    }

    if (!identity.repository?.trim()) {
        throw new Error("Unable to determine the Pull Request repository.");
    }

    if (!Number.isInteger(identity.pullRequestId) || identity.pullRequestId <= 0) {
        throw new Error("Unable to determine the Pull Request ID.");
    }

    return (
        `rest/api/latest/projects/${encodeURIComponent(identity.projectKey)}` +
        `/repos/${encodeURIComponent(identity.repository)}` +
        `/pull-requests/${identity.pullRequestId}`
    );
}
