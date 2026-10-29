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

export type BitbucketPullRequest = {
    id: number;
    version: number;
    state: string;

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
