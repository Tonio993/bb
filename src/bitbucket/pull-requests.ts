import {
    BitbucketClient,
} from "./bitbucket-client.ts";

import type {
    BitbucketCommitMessageSuggestion,
    BitbucketPage,
    BitbucketPullRequest,
    BitbucketPullRequestTask,
    BitbucketRepository,
} from "./bitbucket-types.ts";

import {
    getProjectRepositories,
} from "./repositories.ts";

import {
    assertPullRequestReview,
} from "../pullrequest/review-validation.ts";

import {
    buildMergeCommitMessage,
} from "../pullrequest/merge-commit-message.ts";


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

        if (
            response.nextPageStart === undefined ||
            !Number.isInteger(response.nextPageStart) ||
            response.nextPageStart <= start
        ) {
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

        if (
            response.nextPageStart === undefined ||
            !Number.isInteger(response.nextPageStart) ||
            response.nextPageStart <= start
        ) {
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


export type PullRequestIdentity = {
    projectKey: string;
    repository: string;
    pullRequestId: number;
};

export async function getPullRequest(
    client: BitbucketClient,
    identity: PullRequestIdentity,
): Promise<BitbucketPullRequest> {
    return client.get<BitbucketPullRequest>(
        getPullRequestPath(identity),
    );
}

export type MergePullRequestOptions = {
    messagePrefix?: string;
    completeTasks?: boolean;
};

function assertPullRequestCanMerge(
    pullRequest: BitbucketPullRequest,
): void {
    if (pullRequest.state !== "OPEN") {
        throw new Error(
            "Only open Pull Requests can be merged.",
        );
    }

    if (!Number.isInteger(pullRequest.version) || pullRequest.version < 0) {
        throw new Error(
            "Unable to determine the Pull Request version.",
        );
    }

    assertPullRequestReview(pullRequest.reviewers);
}

export async function mergePullRequest(
    client: BitbucketClient,
    pullRequest: BitbucketPullRequest,
    options: MergePullRequestOptions = {},
): Promise<BitbucketPullRequest> {
    assertPullRequestCanMerge(pullRequest);

    const path = getPullRequestPath({
        projectKey: pullRequest.toRef?.repository?.project?.key,
        repository: pullRequest.toRef?.repository?.slug,
        pullRequestId: pullRequest.id,
    });

    let currentPullRequest = pullRequest;

    if (options.completeTasks) {
        await completePullRequestTasks(client, path);
        currentPullRequest = await client.get<BitbucketPullRequest>(path);

        if (
            currentPullRequest.fromRef.id !== pullRequest.fromRef.id ||
            currentPullRequest.toRef.id !== pullRequest.toRef.id
        ) {
            throw new Error(
                "Pull Request branches changed while completing tasks. Run the command again.",
            );
        }

        assertPullRequestCanMerge(currentPullRequest);
    }

    const body: {
        version: number;
        message?: string;
        autoSubject?: boolean;
    } = {
        version: currentPullRequest.version,
    };

    if (options.messagePrefix?.trim()) {
        const suggestion = await client.get<BitbucketCommitMessageSuggestion>(
            `${path}/commit-message-suggestion`,
        );

        body.message = buildMergeCommitMessage(suggestion, options.messagePrefix);
        body.autoSubject = false;
    }

    const mergedPullRequest = await client.post<BitbucketPullRequest>(
        `${path}/merge`,
        body,
    );

    if (mergedPullRequest.state !== "MERGED") {
        throw new Error(
            "Bitbucket did not confirm that the Pull Request was merged.",
        );
    }

    return mergedPullRequest;
}

async function completePullRequestTasks(
    client: BitbucketClient,
    pullRequestPath: string,
): Promise<void> {
    const tasks: BitbucketPullRequestTask[] = [];
    let start = 0;

    // Read all pages before updates so resolving tasks cannot shift the remaining pages.
    while (true) {
        const page = await client.get<BitbucketPage<BitbucketPullRequestTask>>(
            `${pullRequestPath}/blocker-comments?start=${start}&limit=100`,
        );
        tasks.push(...page.values);

        if (page.isLastPage) {
            break;
        }

        if (
            page.nextPageStart === undefined ||
            !Number.isInteger(page.nextPageStart) ||
            page.nextPageStart <= start
        ) {
            throw new Error("Bitbucket did not provide the next Pull Request task page.");
        }

        start = page.nextPageStart;
    }

    for (const task of tasks) {
        if (task.state === "RESOLVED") {
            continue;
        }

        if (!Number.isInteger(task.id) || task.id <= 0) {
            throw new Error("Bitbucket did not provide a valid Pull Request task ID.");
        }

        const taskPath = `${pullRequestPath}/comments/${task.id}`;
        const current = await client.get<BitbucketPullRequestTask>(taskPath);

        if (current.state === "RESOLVED" || current.severity === "NORMAL") {
            continue;
        }

        if (
            current.state !== "OPEN" || current.severity !== "BLOCKER" ||
            !Number.isInteger(current.version) || current.version < 0
        ) {
            throw new Error(`Bitbucket did not provide valid details for Pull Request task #${task.id}.`);
        }

        const completed = await client.put<BitbucketPullRequestTask>(taskPath, {
            version: current.version,
            state: "RESOLVED",
        });

        if (completed.state !== "RESOLVED") {
            throw new Error(`Bitbucket did not confirm completion of Pull Request task #${task.id}.`);
        }
    }
}

function getPullRequestPath(
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
