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
    latestCommit?: string;
    repository: BitbucketRepository;
};

export type BitbucketPullRequestReviewer = {
    status: string;
    user?: BitbucketUser;
};

export type BitbucketUser = { name?: string; slug?: string; displayName?: string };

export type BitbucketCommitMessageSuggestion = {
    title?: string;
    body?: string;
};

export type BitbucketPullRequestTask = {
    id: number;
    version: number;
    state: string;
    severity: string;
    text?: string;
};

export type BitbucketPullRequest = {
    id: number;
    version: number;
    state: string;
    reviewers: BitbucketPullRequestReviewer[];
    title?: string;
    author?: { user: BitbucketUser };

    fromRef: BitbucketPullRequestRef;
    toRef: BitbucketPullRequestRef;

    links: {
        self: {
            href: string;
        }[];
    };
};

export type BitbucketPullRequestDetails = BitbucketPullRequest & {
    title: string;
    author: { user: BitbucketUser };
};

export type BitbucketPage<T> = {
    values: T[];
    size: number;
    limit: number;
    start: number;
    isLastPage: boolean;
    nextPageStart?: number;
};
