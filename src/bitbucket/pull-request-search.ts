import type { BitbucketApi } from "./bitbucket-client.ts";
import type { BitbucketPullRequest, BitbucketRepository } from "./bitbucket-types.ts";
import { iterateBitbucketPages } from "./pagination.ts";
import type {
    GetOpenPullRequestOptions,
    GetOpenPullRequestsOptions,
    BitbucketPullRequestWithRepository,
    ListRepositoryPullRequestsOptions,
} from "./pull-request-types.ts";
import { getProjectRepositories } from "./repositories.ts";
import { parsePullRequest, parsePullRequestDetails } from "./response-parsers.ts";
import type { BitbucketPullRequestDetails } from "./bitbucket-types.ts";

export async function listRepositoryPullRequests(
    client: Pick<BitbucketApi, "get">,
    options: ListRepositoryPullRequestsOptions,
): Promise<BitbucketPullRequestDetails[]> {
    if (!["OPEN", "MERGED", "DECLINED", "ALL"].includes(options.state))
        throw new Error("Invalid Pull Request state filter.");
    if (options.author !== undefined && !options.author.trim())
        throw new Error("Author filter cannot be empty.");
    const author = options.author?.trim().toLowerCase();
    const results: BitbucketPullRequestDetails[] = [];
    for await (const page of iterateBitbucketPages(
        client,
        repositoryPullRequestsPath(options.projectKey, options.repository, options.state),
        parsePullRequestDetails,
        "Pull Request",
    )) {
        for (const pr of page.values) {
            if (options.state !== "ALL" && pr.state !== options.state) continue;
            if (
                author &&
                ![pr.author.user.name, pr.author.user.slug].some(
                    (value) => value?.toLowerCase() === author,
                )
            )
                continue;
            results.push(pr);
        }
    }
    return results;
}

export async function getOpenPullRequest(
    client: Pick<BitbucketApi, "get">,
    options: GetOpenPullRequestOptions,
): Promise<BitbucketPullRequest | undefined> {
    const { projectKey, repository, sourceBranch, targetBranch } = options;

    for await (const response of getRepositoryPullRequestPages(client, projectKey, repository)) {
        const pullRequest = response.values.find(
            (value) =>
                value.fromRef.id === `refs/heads/${sourceBranch}` &&
                value.toRef.id === `refs/heads/${targetBranch}` &&
                (!options.sourceRepository ||
                    (value.state === "OPEN" &&
                        value.fromRef.repository.project.key.toLowerCase() ===
                            options.sourceRepository.projectKey.toLowerCase() &&
                        value.fromRef.repository.slug.toLowerCase() ===
                            options.sourceRepository.repository.toLowerCase() &&
                        value.toRef.repository.project.key.toLowerCase() ===
                            projectKey.toLowerCase() &&
                        value.toRef.repository.slug.toLowerCase() === repository.toLowerCase())),
        );

        if (pullRequest) {
            return pullRequest;
        }
    }
    return undefined;
}

export async function getOpenPullRequests(
    client: Pick<BitbucketApi, "get">,
    options: GetOpenPullRequestsOptions,
): Promise<BitbucketPullRequestWithRepository[]> {
    const repositories = await getProjectRepositories(client, options.projectKey);

    const matchingRepositories = repositories.filter((repository) =>
        matchesRepositoryFilter(repository, options.repositoryFilter),
    );

    const pullRequests: BitbucketPullRequestWithRepository[] = [];

    for (const repository of matchingRepositories) {
        const repositoryPullRequests = await getRepositoryOpenPullRequests(
            client,
            options.projectKey,
            repository,
            options.sourceBranch,
            options.targetBranch,
        );

        pullRequests.push(...repositoryPullRequests);
    }

    return pullRequests;
}

async function getRepositoryOpenPullRequests(
    client: Pick<BitbucketApi, "get">,
    projectKey: string,
    repository: BitbucketRepository,
    sourceBranch: string,
    targetBranch: string,
): Promise<BitbucketPullRequestWithRepository[]> {
    const pullRequests: BitbucketPullRequestWithRepository[] = [];

    for await (const response of getRepositoryPullRequestPages(
        client,
        projectKey,
        repository.slug,
    )) {
        const matches = response.values
            .filter(
                (pullRequest) =>
                    pullRequest.fromRef.id === `refs/heads/${sourceBranch}` &&
                    pullRequest.toRef.id === `refs/heads/${targetBranch}`,
            )
            .map((pullRequest) => ({
                ...pullRequest,
                repository,
            }));

        pullRequests.push(...matches);
    }
    return pullRequests;
}

function getRepositoryPullRequestPages(
    client: Pick<BitbucketApi, "get">,
    projectKey: string,
    repository: string,
) {
    const path = repositoryPullRequestsPath(projectKey, repository, "OPEN");
    return iterateBitbucketPages(client, path, parsePullRequest, "Pull Request");
}

function repositoryPullRequestsPath(projectKey: string, repository: string, state: string): string {
    if (!projectKey.trim() || !repository.trim())
        throw new Error("Pull Request project and repository are required.");
    return `rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repository)}/pull-requests?state=${encodeURIComponent(state)}`;
}

function matchesRepositoryFilter(
    repository: BitbucketRepository,
    filter: string | undefined,
): boolean {
    if (!filter?.trim()) {
        return true;
    }

    const expression = wildcardToRegExp(filter.trim());

    return expression.test(repository.name) || expression.test(repository.slug);
}

function wildcardToRegExp(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");

    return new RegExp(`^${escaped}$`, "i");
}
