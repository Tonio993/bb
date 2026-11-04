import { spawnSync } from "node:child_process";
import { basename } from "node:path";

import { normalizeBitbucketUrl } from "../config/bitbucket-url.ts";
import { GitCommandError } from "./git-command-error.ts";
import type { GitRunOptions, GitCommit, GitCommandRunner } from "./git-types.ts";

type TokenProvider = () => string;

type BitbucketUrlProvider = () => string | undefined;

type GitExecutionResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

const maxCaptureBytes = 16 * 1024 * 1024;

type GitClientOptions = { execute?: GitCommandRunner };

export class GitClient {
    readonly remote: string;

    private readonly tokenProvider: TokenProvider;
    private readonly bitbucketUrlProvider: BitbucketUrlProvider;
    private readonly executeCommand: GitCommandRunner;

    constructor(
        remote: string,
        tokenProvider: TokenProvider,
        bitbucketUrlProvider: BitbucketUrlProvider,
        options: GitClientOptions = {},
    ) {
        this.remote = remote;
        this.tokenProvider = tokenProvider;
        this.bitbucketUrlProvider = bitbucketUrlProvider;
        this.executeCommand =
            options.execute ?? ((command, args, settings) => spawnSync(command, args, settings));
    }

    run(args: string[], options: GitRunOptions = {}): number {
        return this.execute(args, options.authenticated ?? requiresAuthentication(args), "inherit")
            .exitCode;
    }

    currentBranch(): string {
        const branch = this.capture(["branch", "--show-current"]);

        if (!branch) {
            throw new Error("Unable to determine the current Git branch.");
        }

        return branch;
    }

    version(): string {
        const args = ["--version"];
        const result = this.execute(args, false, "pipe", 10000);
        this.assertExitCode(result, args);
        return result.stdout.trim();
    }

    currentRepository(): string {
        const repositoryPath = this.capture(["rev-parse", "--show-toplevel"]);

        if (!repositoryPath) {
            throw new Error("Unable to determine the current Git repository.");
        }

        return basename(repositoryPath);
    }

    fetch(remote: string = this.remote): void {
        this.capture(["fetch", remote], true);
    }

    localBranchExists(branch: string): boolean {
        return this.branchExists(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    }

    remoteBranchExists(branch: string, remote: string = this.remote): boolean {
        return this.branchExists([
            "show-ref",
            "--verify",
            "--quiet",
            `refs/remotes/${remote}/${branch}`,
        ]);
    }

    private capture(args: string[], authenticated = false): string {
        const result = this.execute(args, authenticated);
        this.assertExitCode(result, args);
        return result.stdout.trim();
    }

    private branchExists(args: string[]): boolean {
        const result = this.execute(args);
        this.assertExitCode(result, args, [0, 1]);
        return result.exitCode === 0;
    }

    private execute(
        args: string[],
        authenticated = false,
        stdio: "inherit" | "pipe" = "pipe",
        timeout?: number,
    ): GitExecutionResult {
        const result = this.executeCommand("git", args, {
            encoding: "utf8",
            stdio,
            shell: false,
            windowsHide: true,
            maxBuffer: maxCaptureBytes,
            timeout,
            env: this.createEnvironment(authenticated),
        });

        if (result.error) {
            const code = (result.error as NodeJS.ErrnoException).code;
            const message =
                code === "ENOBUFS"
                    ? "Git output exceeded the 16 MiB capture limit. Narrow the commit range or reduce the command output."
                    : `Unable to execute Git: ${result.error.message}`;
            throw new GitCommandError(message, { args, signal: result.signal ?? undefined });
        }

        if (result.signal) {
            throw new GitCommandError(`Git was terminated by signal ${result.signal}.`, {
                args,
                signal: result.signal,
            });
        }

        if (result.status === null) {
            throw new GitCommandError("Git terminated without an exit code.", { args });
        }

        return {
            exitCode: result.status,
            stdout: result.stdout?.toString() ?? "",
            stderr: result.stderr?.toString() ?? "",
        };
    }

    private assertExitCode(
        result: GitExecutionResult,
        args: string[],
        allowed: readonly number[] = [0],
    ): void {
        if (!allowed.includes(result.exitCode)) {
            throw new GitCommandError(
                result.stderr.trim() || `Git command failed with exit code ${result.exitCode}.`,
                { args, exitCode: result.exitCode },
            );
        }
    }

    private createEnvironment(authenticated: boolean): NodeJS.ProcessEnv {
        if (!authenticated) {
            return process.env;
        }

        const environment = {
            ...process.env,
        };

        const configCount = getGitConfigCount(environment.GIT_CONFIG_COUNT);

        const authenticationKey = getAuthenticationKey(this.bitbucketUrlProvider());

        environment.GIT_CONFIG_COUNT = String(configCount + 1);

        environment[`GIT_CONFIG_KEY_${configCount}`] = authenticationKey;

        environment[`GIT_CONFIG_VALUE_${configCount}`] =
            `Authorization: Bearer ${this.tokenProvider()}`;

        return environment;
    }

    assertRemoteBranchExists(
        branch: string,
        branchType?: string,
        remote: string = this.remote,
    ): void {
        if (this.remoteBranchExists(branch, remote)) {
            return;
        }

        const description = branchType ? `Remote ${branchType} branch` : "Remote branch";

        throw new Error(`${description} '${remote}/${branch}' does not exist.`);
    }

    commitsBetween(targetRef: string, sourceRef: string): GitCommit[] {
        const fieldSeparator = "\x1e";
        const commitSeparator = "\x1d";

        const output = this.capture([
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
                const separatorIndex = entry.indexOf(fieldSeparator);

                if (separatorIndex < 0) {
                    return {
                        subject: entry,
                        body: "",
                    };
                }

                return {
                    subject: entry.slice(0, separatorIndex).trim(),

                    body: entry.slice(separatorIndex + 1).trim(),
                };
            });
    }
}

function requiresAuthentication(args: readonly string[]): boolean {
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
            argument === "--help" ||
            argument === "-h" ||
            argument === "--version" ||
            argument === "-v"
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

        return ["fetch", "pull", "push", "clone", "ls-remote"].includes(argument);
    }

    return false;
}

function getGitConfigCount(value: string | undefined): number {
    if (value === undefined) {
        return 0;
    }

    const count = Number(value);

    if (!/^\d+$/.test(value) || !Number.isSafeInteger(count + 1)) {
        throw new Error(
            "Invalid GIT_CONFIG_COUNT. Expected a non-negative decimal integer with room for one additional entry.",
        );
    }

    return count;
}

function getAuthenticationKey(value: string | undefined): string {
    if (!value?.trim()) {
        throw new Error(
            "Required configuration 'bitbucket.url' is missing.\n\n" +
                'Configure it with:\n  bb config bitbucket.url "https://bitbucket.company.com"\n\n' +
                "Or run:\n  bb config init",
        );
    }

    return `http.${normalizeBitbucketUrl(value)}/.extraHeader`;
}
