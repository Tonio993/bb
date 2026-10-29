export type BitbucketRepository = {
    name: string;
    slug: string;
    project: {
        key: string;
    };
};

export type BitbucketPullRequestRef = {
    id: string;
    displayId: string;
    repository: BitbucketRepository;
};

export type BitbucketPullRequestReviewer = {
    status: string;
};

export type BitbucketCommitMessageSuggestion = {
    title?: string;
    body?: string;
};

export type BitbucketPullRequestTask = {
    id: number;
    version: number;
    state: string;
    severity: string;
};

export type BitbucketPullRequest = {
    id: number;
    version: number;
    state: string;
    reviewers: BitbucketPullRequestReviewer[];

    fromRef: BitbucketPullRequestRef;
    toRef: BitbucketPullRequestRef;

    links: {
        self: {
            href: string;
        }[];
    };
};

export type BitbucketPage<T> = {
    values: T[];
    size: number;
    limit: number;
    start: number;
    isLastPage: boolean;
    nextPageStart?: number;
};
