import type {
    BitbucketPullRequestDetails,
    BitbucketPullRequestTask,
} from "../bitbucket/bitbucket-types.ts";

export type PullRequestView = {
    pullRequest: BitbucketPullRequestDetails;
    openTasks: BitbucketPullRequestTask[];
};
