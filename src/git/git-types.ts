import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";

import type { GitClient } from "./git-client.ts";

export type GitRunOptions = {
    authenticated?: boolean;
};

export type GitCommit = {
    subject: string;
    body: string;
};

export type GitOperations = Pick<
    GitClient,
    | "run"
    | "currentBranch"
    | "currentRepository"
    | "remoteFetchUrl"
    | "fetch"
    | "assertRemoteBranchExists"
    | "commitsBetween"
>;

export type GitCommandRunner = (
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
) => {
    stdout: string | null;
    stderr: string | null;
    status: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
};
