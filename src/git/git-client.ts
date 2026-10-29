import {
    spawnSync,
} from "node:child_process";

import {
    basename,
} from "node:path";

import {
    getBitbucketToken,
} from "../auth/token-store.ts";

import {
    GitCommandError,
} from "./git-command-error.ts";

type TokenProvider =
    () => string;


export type GitRunOptions = {
    authenticated?: boolean;
};

export type GitCommit = {
    subject: string;
    body: string;
};

export class GitClient {
    readonly remote: string;

    private readonly tokenProvider: TokenProvider;


    constructor(
        remote: string,
        tokenProvider: TokenProvider = getBitbucketToken,
    ) {
        this.remote = remote;
        this.tokenProvider = tokenProvider;
    }


    run(
        args: string[],
        options: GitRunOptions = {},
    ): number {
        const result =
            spawnSync(
                "git",
                args,
                {
                    stdio: "inherit",
                    shell: false,
                    windowsHide: true,
                    env: this.createEnvironment(
                        options.authenticated ?? requiresAuthentication(args),
                    ),
                },
            );

            if (result.error) {
                throw new GitCommandError(
                    `Unable to execute Git: ${result.error.message}`,
                    {
                        args,
                    },
                );
            }

        return result.status ?? 1;
    }


    currentBranch(): string {
        const branch =
            this.capture([
                "branch",
                "--show-current",
            ]);

        if (!branch) {
            throw new Error(
                "Unable to determine the current Git branch.",
            );
        }

        return branch;
    }


    currentRepository(): string {
        const repositoryPath =
            this.capture([
                "rev-parse",
                "--show-toplevel",
            ]);

        if (!repositoryPath) {
            throw new Error(
                "Unable to determine the current Git repository.",
            );
        }

        return basename(
            repositoryPath,
        );
    }


    fetch(
        remote: string = this.remote,
    ): void {
        this.capture(
            [
                "fetch",
                remote,
            ],
            true,
        );
    }


    localBranchExists(
        branch: string,
    ): boolean {
        return this.exitCode([
            "show-ref",
            "--verify",
            "--quiet",
            `refs/heads/${branch}`,
        ]) === 0;
    }


    remoteBranchExists(
        branch: string,
        remote: string = this.remote,
    ): boolean {
        return this.exitCode([
            "show-ref",
            "--verify",
            "--quiet",
            `refs/remotes/${remote}/${branch}`,
        ]) === 0;
    }


    private capture(
        args: string[],
        authenticated = false,
    ): string {
        const result =
            spawnSync(
                "git",
                args,
                {
                    encoding: "utf8",
                    shell: false,
                    windowsHide: true,
                    env: this.createEnvironment(
                        authenticated,
                    ),
                },
            );

            if (result.error) {
                throw new GitCommandError(
                    `Unable to execute Git: ${result.error.message}`,
                    {
                        args,
                    },
                );
            }

            if (result.status !== 0) {
                const message =
                    result.stderr?.trim() ||
                    `Git command failed with exit code ${result.status}.`;

                throw new GitCommandError(
                    message,
                    {
                        exitCode:
                            result.status ?? undefined,
                        args,
                    },
                );
            }

        return result.stdout.trim();
    }


    private exitCode(
        args: string[],
    ): number {
        const result =
            spawnSync(
                "git",
                args,
                {
                    stdio: "ignore",
                    shell: false,
                    windowsHide: true,
                },
            );

            if (result.error) {
                throw new GitCommandError(
                    `Unable to execute Git: ${result.error.message}`,
                    {
                        args,
                    },
                );
            }

        return result.status ?? 1;
    }


    private createEnvironment(
        authenticated: boolean,
    ): NodeJS.ProcessEnv {
        if (!authenticated) {
            return process.env;
        }

        const environment = {
            ...process.env,
        };

        const configCount =
            getGitConfigCount(
                environment.GIT_CONFIG_COUNT,
            );

        environment.GIT_CONFIG_COUNT =
            String(configCount + 1);

        environment[
            `GIT_CONFIG_KEY_${configCount}`
        ] = "http.extraHeader";

        environment[
            `GIT_CONFIG_VALUE_${configCount}`
        ] =
            `Authorization: Bearer ${this.tokenProvider()}`;

        return environment;
    }
    

    assertRemoteBranchExists(
        branch: string,
        branchType?: string,
        remote: string = this.remote,
    ): void {
        if (
            this.remoteBranchExists(
                branch,
                remote,
            )
        ) {
            return;
        }

        const description =
            branchType
                ? `Remote ${branchType} branch`
                : "Remote branch";

        throw new Error(
            `${description} '${remote}/${branch}' does not exist.`,
        );
    }


    commitsBetween(
        targetRef: string,
        sourceRef: string,
    ): GitCommit[] {
        const fieldSeparator = "\x1e";
        const commitSeparator = "\x1d";

        const output =
            this.capture([
                "log",
                `${targetRef}..${sourceRef}`,
                "--no-merges",
                "--reverse",
                "--format=%s%x1e%b%x1d",
            ]);

        if (!output) {
            return [];
        }

        return output
            .split(commitSeparator)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const separatorIndex =
                    entry.indexOf(
                        fieldSeparator,
                    );

                if (separatorIndex < 0) {
                    return {
                        subject: entry,
                        body: "",
                    };
                }

                return {
                    subject:
                        entry
                            .slice(
                                0,
                                separatorIndex,
                            )
                            .trim(),

                    body:
                        entry
                            .slice(
                                separatorIndex + 1,
                            )
                            .trim(),
                };
            });
    }
}


function requiresAuthentication(
    args: readonly string[],
): boolean {
    const optionsWithValue = [
        "-C",
        "-c",
        "--git-dir",
        "--work-tree",
        "--namespace",
        "--config-env",
        "--attr-source",
    ];

    // Leave argument validation to Git; only determine whether to add authentication.
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];

        if (
            argument === "--help" || argument === "-h" ||
            argument === "--version" || argument === "-v"
        ) {
            return false;
        }

        if (optionsWithValue.includes(argument)) {
            index++;
            continue;
        }

        if (argument.startsWith("-")) {
            continue;
        }

        for (const commandArgument of args.slice(index + 1)) {
            if (commandArgument === "--") {
                break;
            }

            if (
                commandArgument === "--help" ||
                (commandArgument === "-h" && argument !== "ls-remote")
            ) {
                return false;
            }
        }

        return [
            "fetch",
            "pull",
            "push",
            "clone",
            "ls-remote",
        ].includes(argument);
    }

    return false;
}


function getGitConfigCount(
    value: string | undefined,
): number {
    if (!value) {
        return 0;
    }

    const count =
        Number.parseInt(
            value,
            10,
        );

    if (
        !Number.isInteger(count) ||
        count < 0
    ) {
        return 0;
    }

    return count;
}
