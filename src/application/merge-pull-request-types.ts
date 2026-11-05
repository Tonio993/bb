import type { BitbucketPullRequest } from "../bitbucket/bitbucket-types.ts";
import type { GetOpenPullRequestOptions } from "../bitbucket/pull-request-types.ts";

export type MergeOpenPullRequestOptions = GetOpenPullRequestOptions & {
    messagePrefix?: string;
    completeTasks?: boolean;
    deleteSource?: boolean;
};

export type MergeOpenPullRequestResult = {
    pullRequest: BitbucketPullRequest;
} & ({ sourceDeletion: "not-requested" | "deleted" } | { sourceDeletion: "failed"; error: Error });
