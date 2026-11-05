import type { BitbucketMergeability } from "../bitbucket/bitbucket-types.ts";
import type { MergeCheck } from "../pull-request/merge-check-types.ts";
import type { PullRequestView } from "./pull-request-view-types.ts";

export type PullRequestChecks = {
    view: PullRequestView;
    server: BitbucketMergeability | null;
    checks: MergeCheck[];
    readyForMerge: boolean;
};
