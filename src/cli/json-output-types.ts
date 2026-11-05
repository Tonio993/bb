import type { BitbucketUser } from "../bitbucket/bitbucket-types.ts";
import type { MergeCheck } from "../pull-request/merge-check-types.ts";

export type JsonErrorCode =
    | "CLI_ARGUMENT_ERROR"
    | "JSON_OUTPUT_UNSUPPORTED"
    | "APPLICATION_ERROR"
    | "AUTHENTICATION_FAILED"
    | "ACCESS_DENIED"
    | "NOT_FOUND"
    | "CONFLICT"
    | "RATE_LIMITED"
    | "BITBUCKET_UNAVAILABLE"
    | "HTTP_ERROR"
    | "CONNECTION_FAILED"
    | "TIMEOUT"
    | "INVALID_RESPONSE"
    | "GIT_ERROR"
    | "DIAGNOSTIC_FAILED"
    | "MERGE_CHECK_FAILED"
    | "SOURCE_DELETION_FAILED";

export type JsonError = {
    code: JsonErrorCode;
    message: string;
    httpStatus?: number;
    method?: string;
    kind?: "http" | "connection" | "timeout" | "response";
    gitExitCode?: number;
    signal?: string;
    cause?: JsonError;
};

export type JsonResult<T> = {
    schemaVersion: 1;
    command: string | null;
    ok: boolean;
    exitCode: 0 | 1;
    data: T | null;
    error: JsonError | null;
};

export type PullRequestOutput = {
    id: number;
    version: number;
    state: string;
    url: string | null;
    source: { projectKey: string; repository: string; branch: string; ref: string };
    target: { projectKey: string; repository: string; branch: string; ref: string };
    reviewers: { status: string }[];
};

export type PullRequestViewOutput = Omit<PullRequestOutput, "reviewers"> & {
    title: string;
    author: BitbucketUser;
    reviewers: { status: string; user: BitbucketUser | null }[];
    openTasks: { id: number; text: string | null }[];
};

export type PullRequestChecksOutput = {
    pullRequest: PullRequestViewOutput;
    readyForMerge: boolean;
    checks: MergeCheck[];
    server: {
        canMerge: boolean;
        conflicted: boolean;
        outcome: string | null;
        vetoes: { summaryMessage: string; detailedMessage: string | null }[];
    } | null;
};
