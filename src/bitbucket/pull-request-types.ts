import type { BitbucketPullRequest, BitbucketRepository } from "./bitbucket-types.ts";

export type GetOpenPullRequestOptions = {
    projectKey: string;
    repository: string;
    sourceBranch: string;
    targetBranch: string;
    sourceRepository?: { projectKey: string; repository: string };
};

export type GetOpenPullRequestsOptions = {
    projectKey: string;
    sourceBranch: string;
    targetBranch: string;
    repositoryFilter?: string;
};

export type BitbucketPullRequestWithRepository = BitbucketPullRequest & {
    repository: BitbucketRepository;
};

export type CreatePullRequestOptions = {
    projectKey: string;
    repository: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
    reviewers: string[];
};

export type PullRequestIdentity = {
    projectKey: string;
    repository: string;
    pullRequestId: number;
};

export type MergePullRequestBody = {
    version: number;
    message?: string;
    autoSubject?: boolean;
};

export type PullRequestListState = "OPEN" | "MERGED" | "DECLINED" | "ALL";
export type ListRepositoryPullRequestsOptions = {
    projectKey: string;
    repository: string;
    state: PullRequestListState;
    author?: string;
};
