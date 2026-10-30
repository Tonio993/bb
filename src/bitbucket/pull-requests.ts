import {
    BitbucketClient,
} from "./bitbucket-client.ts";

import type {
    BitbucketCommitMessageSuggestion,
    BitbucketPullRequest,
    BitbucketRepository,
} from "./bitbucket-types.ts";
import { parseCommitMessageSuggestion, parsePullRequest } from "./response-parsers.ts";
import { iterateBitbucketPages } from "./pagination.ts";

import {
    getProjectRepositories,
} from "./repositories.ts";


export type GetOpenPullRequestOptions = {
    projectKey: string;
    repository: string;
    sourceBranch: string;
    targetBranch: string;
};


export type GetOpenPullRequestsOptions = {
    projectKey: string;
    sourceBranch: string;
    targetBranch: string;
    repositoryFilter?: string;
};


export type BitbucketPullRequestWithRepository =
    BitbucketPullRequest & {
        repository: BitbucketRepository;
    };


export async function getOpenPullRequest(
    client: BitbucketClient,
    options: GetOpenPullRequestOptions,
): Promise<BitbucketPullRequest | undefined> {
    const {
        projectKey,
        repository,
        sourceBranch,
        targetBranch,
    } = options;

    for await (const response of getRepositoryPullRequestPages(client, projectKey, repository)) {
        const pullRequest =
            response.values.find(
                (value) =>
                    value.fromRef.id ===
                        `refs/heads/${sourceBranch}` &&
                    value.toRef.id ===
                        `refs/heads/${targetBranch}`,
            );

        if (pullRequest) {
            return pullRequest;
        }

    }
    return undefined;
}


export async function getOpenPullRequests(
    client: BitbucketClient,
    options: GetOpenPullRequestsOptions,
): Promise<BitbucketPullRequestWithRepository[]> {
    const repositories =
        await getProjectRepositories(
            client,
            options.projectKey,
        );

    const matchingRepositories =
        repositories.filter(
            (repository) =>
                matchesRepositoryFilter(
                    repository,
                    options.repositoryFilter,
                ),
        );

    const pullRequests:
        BitbucketPullRequestWithRepository[] = [];

    for (const repository of matchingRepositories) {
        const repositoryPullRequests =
            await getRepositoryOpenPullRequests(
                client,
                options.projectKey,
                repository,
                options.sourceBranch,
                options.targetBranch,
            );

        pullRequests.push(
            ...repositoryPullRequests,
        );
    }

    return pullRequests;
}


async function getRepositoryOpenPullRequests(
    client: BitbucketClient,
    projectKey: string,
    repository: BitbucketRepository,
    sourceBranch: string,
    targetBranch: string,
): Promise<BitbucketPullRequestWithRepository[]> {
    const pullRequests:
        BitbucketPullRequestWithRepository[] = [];

    for await (const response of getRepositoryPullRequestPages(client, projectKey, repository.slug)) {
        const matches =
            response.values
                .filter(
                    (pullRequest) =>
                        pullRequest.fromRef.id ===
                            `refs/heads/${sourceBranch}` &&
                        pullRequest.toRef.id ===
                            `refs/heads/${targetBranch}`,
                )
                .map(
                    (pullRequest) => ({
                        ...pullRequest,
                        repository,
                    }),
                );

        pullRequests.push(
            ...matches,
        );

    }
    return pullRequests;
}

function getRepositoryPullRequestPages(
    client: BitbucketClient,
    projectKey: string,
    repository: string,
) {
    const path = `rest/api/latest/projects/${encodeURIComponent(projectKey)}` +
        `/repos/${encodeURIComponent(repository)}/pull-requests?state=OPEN`;
    return iterateBitbucketPages(client, path, parsePullRequest, "Pull Request");
}

function matchesRepositoryFilter(
    repository: BitbucketRepository,
    filter: string | undefined,
): boolean {
    if (!filter?.trim()) {
        return true;
    }

    const expression =
        wildcardToRegExp(
            filter.trim(),
        );

    return (
        expression.test(repository.name) ||
        expression.test(repository.slug)
    );
}


function wildcardToRegExp(
    pattern: string,
): RegExp {
    const escaped =
        pattern
            .replace(
                /[.+^${}()|[\]\\]/g,
                "\\$&",
            )
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");

    return new RegExp(
        `^${escaped}$`,
        "i",
    );
}


export type CreatePullRequestOptions = {
    projectKey: string;
    repository: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
    reviewers: string[];
};


export async function createPullRequest(
    client: BitbucketClient,
    options: CreatePullRequestOptions,
): Promise<BitbucketPullRequest> {
    const encodedProjectKey =
        encodeURIComponent(
            options.projectKey,
        );

    const encodedRepository =
        encodeURIComponent(
            options.repository,
        );

    const path =
        `rest/api/latest/projects/${encodedProjectKey}` +
        `/repos/${encodedRepository}` +
        `/pull-requests`;

    const body = {
        title:
            options.title,

        description:
            options.description,

        fromRef: {
            id:
                `refs/heads/${options.sourceBranch}`,
        },

        toRef: {
            id:
                `refs/heads/${options.targetBranch}`,
        },

        reviewers:
            options.reviewers.map(
                (reviewer) => ({
                    user: {
                        name:
                            reviewer,
                    },
                }),
            ),
    };

    return client.post(
        path,
        body,
        parsePullRequest,
    );
}


export type PullRequestIdentity = {
    projectKey: string;
    repository: string;
    pullRequestId: number;
};

export async function getPullRequest(
    client: BitbucketClient,
    identity: PullRequestIdentity,
): Promise<BitbucketPullRequest> {
    return client.get(
        getPullRequestPath(identity),
        parsePullRequest,
    );
}

export type MergePullRequestBody = {
    version: number;
    message?: string;
    autoSubject?: boolean;
};

export async function mergePullRequest(
    client: BitbucketClient,
    identity: PullRequestIdentity,
    body: MergePullRequestBody,
): Promise<BitbucketPullRequest> {
    return client.post(
        `${getPullRequestPath(identity)}/merge`,
        body,
        parsePullRequest,
    );
}

export async function getPullRequestCommitMessageSuggestion(
    client: BitbucketClient,
    identity: PullRequestIdentity,
): Promise<BitbucketCommitMessageSuggestion> {
    return client.get(
        `${getPullRequestPath(identity)}/commit-message-suggestion`,
        parseCommitMessageSuggestion,
    );
}

export function getPullRequestPath(
    identity: PullRequestIdentity,
): string {
    if (!identity.projectKey?.trim()) {
        throw new Error("Unable to determine the Pull Request project.");
    }

    if (!identity.repository?.trim()) {
        throw new Error("Unable to determine the Pull Request repository.");
    }

    if (!Number.isInteger(identity.pullRequestId) || identity.pullRequestId <= 0) {
        throw new Error("Unable to determine the Pull Request ID.");
    }

    return `rest/api/latest/projects/${encodeURIComponent(identity.projectKey)}` +
        `/repos/${encodeURIComponent(identity.repository)}` +
        `/pull-requests/${identity.pullRequestId}`;
}
