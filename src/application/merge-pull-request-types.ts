import type {
    BitbucketPullRequest,
    BitbucketPullRequestTask,
} from "../bitbucket/bitbucket-types.ts";
import type { DeleteBranchOptions } from "../bitbucket/branch-types.ts";
import type { GetOpenPullRequestOptions } from "../bitbucket/pull-request-types.ts";

export type MergeOpenPullRequestOptions = GetOpenPullRequestOptions & {
    messagePrefix?: string;
    completeTasks?: boolean;
    deleteSource?: boolean;
};

export type MergeOpenPullRequestResult = {
    pullRequest: BitbucketPullRequest;
} & ({ sourceDeletion: "not-requested" | "deleted" } | { sourceDeletion: "failed"; error: Error });

export type MergePullRequestPreview = {
    pullRequest: BitbucketPullRequest;
    tasksToComplete: BitbucketPullRequestTask[];
    message: string;
    messageMode: "server-default" | "explicit";
    sourceDeletion: DeleteBranchOptions | null;
};
