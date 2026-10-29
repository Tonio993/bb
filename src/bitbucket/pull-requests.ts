import {
    BitbucketClient,
} from "./bitbucket-client.ts";

import type {
    BitbucketPage,
    BitbucketPullRequest,
    BitbucketRepository,
} from "./bitbucket-types.ts";

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

    const encodedProjectKey =
        encodeURIComponent(projectKey);

    const encodedRepository =
        encodeURIComponent(repository);

    let start = 0;
    const limit = 100;

    while (true) {
        const path =
            `rest/api/latest/projects/${encodedProjectKey}` +
            `/repos/${encodedRepository}` +
            `/pull-requests` +
            `?state=OPEN&start=${start}&limit=${limit}`;

        const response =
            await client.get<
                BitbucketPage<BitbucketPullRequest>
            >(path);

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

        if (response.isLastPage) {
            return undefined;
        }

        if (response.nextPageStart === undefined) {
            throw new Error(
                "Bitbucket did not provide the next Pull Request page.",
            );
        }

        start =
            response.nextPageStart;
    }
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
    const encodedProjectKey =
        encodeURIComponent(projectKey);

    const encodedRepository =
        encodeURIComponent(repository.slug);

    const pullRequests:
        BitbucketPullRequestWithRepository[] = [];

    let start = 0;
    const limit = 100;

    while (true) {
        const path =
            `rest/api/latest/projects/${encodedProjectKey}` +
            `/repos/${encodedRepository}` +
            `/pull-requests` +
            `?state=OPEN&start=${start}&limit=${limit}`;

        const response =
            await client.get<
                BitbucketPage<BitbucketPullRequest>
            >(path);

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

        if (response.isLastPage) {
            return pullRequests;
        }

        if (response.nextPageStart === undefined) {
            throw new Error(
                "Bitbucket did not provide the next Pull Request page.",
            );
        }

        start =
            response.nextPageStart;
    }
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

    return client.post<BitbucketPullRequest>(
        path,
        body,
    );
}
