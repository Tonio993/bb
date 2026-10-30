import assert from "node:assert/strict";
import childProcess from "node:child_process";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { runCli } from "../src/cli/cli.ts";
import type { CommandContext } from "../src/cli/command-context.ts";
import { GitClient } from "../src/git/git-client.ts";
import { GitCommandError } from "../src/git/git-command-error.ts";

function mockGit(t: TestContext, result: Partial<SpawnSyncReturns<string | Buffer>> = {}) {
    const execute = t.mock.method(childProcess, "spawnSync", () => ({
        pid: 1,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
        ...result,
    }));
    syncBuiltinESMExports();
    t.after(() => {
        execute.mock.restore();
        syncBuiltinESMExports();
    });
    return execute;
}

function setEnvironment(t: TestContext, values: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(values)) {
        const original = process.env[key];
        t.after(() => {
            if (original === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = original;
            }
        });
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

function createContext(gitClient: GitClient): CommandContext {
    return {
        get tokenStore(): never { throw new Error("Token storage is already injected in Git."); },
        gitClient,
        get configStore(): never {
            throw new Error("The Git command must not access the configuration store.");
        },
        get config(): never {
            throw new Error("The Git command must not load required configuration.");
        },
        get bitbucketClient(): never {
            throw new Error("The Git command must not initialize the REST client.");
        },
    };
}

test("local Git commands do not request a token, including remote command names used as arguments", (t) => {
    const execute = mockGit(t);
    const tokenProvider = t.mock.fn(() => {
        throw new Error("Local Git commands must not request a token.");
    });
    const client = new GitClient("origin", tokenProvider);
    const commands = [
        ["status"],
        ["log", "--oneline"],
        ["branch", "--show-current"],
        ["rev-parse", "--show-toplevel"],
        ["show-ref", "--verify", "refs/heads/main"],
        ["diff", "--", "fetch"],
        ["log", "--grep", "push"],
        ["checkout", "pull"],
        ["remote", "-v"],
        ["help", "fetch"],
        ["--help", "push"],
        ["--version"],
        ["fetch", "--help"],
        ["push", "-h"],
        ["ls-remote", "--help"],
        ["-C", "fetch", "status"],
        ["-c", "alias.example=push", "status"],
        ["--git-dir", "push", "status"],
    ];

    for (const args of commands) {
        assert.equal(client.run(args), 0);
    }
    assert.equal(tokenProvider.mock.callCount(), 0);
    assert.equal(execute.mock.callCount(), commands.length);
    assert.deepEqual(execute.mock.calls.map(({ arguments: args }) => args[1]), commands);
});

test("remote Git commands receive authentication after Git global options without changing arguments", (t) => {
    const execute = mockGit(t);
    setEnvironment(t, {
        GIT_CONFIG_COUNT: undefined,
        GIT_CONFIG_KEY_0: undefined,
        GIT_CONFIG_VALUE_0: undefined,
    });
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    const client = new GitClient("origin", tokenProvider);
    const commands = [
        ["fetch", "origin"],
        ["pull", "--ff-only"],
        ["push", "origin", "feature/test"],
        ["push", "origin", "--", "--help"],
        ["clone", "https://bitbucket.example/repository.git"],
        ["ls-remote", "origin"],
        ["ls-remote", "-h", "origin"],
        ["-C", "repository with spaces", "fetch", "origin"],
        ["-C", "first", "-C", "second", "pull"],
        ["-c", "http.sslVerify=true", "push"],
        ["-cprotocol.version=2", "fetch"],
        ["--no-pager", "--git-dir=repository.git", "fetch"],
        ["--work-tree", "working tree", "--namespace", "test", "fetch"],
        ["--config-env", "http.sslVerify=TEST_SSL_VERIFY", "push"],
    ];

    for (const args of commands) {
        assert.equal(client.run(args), 0);
    }
    assert.equal(tokenProvider.mock.callCount(), commands.length);
    for (const [index, call] of execute.mock.calls.entries()) {
        const [command, args, options] = call.arguments;
        const spawnOptions = options as SpawnSyncOptions;
        assert.equal(command, "git");
        assert.deepEqual(args, commands[index]);
        assert.equal(spawnOptions.stdio, "inherit");
        assert.equal(spawnOptions.shell, false);
        assert.equal(spawnOptions.env?.GIT_CONFIG_COUNT, "1");
        assert.equal(spawnOptions.env?.GIT_CONFIG_KEY_0, "http.extraHeader");
        assert.equal(spawnOptions.env?.GIT_CONFIG_VALUE_0, "Authorization: Bearer test-bitbucket-token");
    }
    assert.equal(process.env.GIT_CONFIG_COUNT, undefined);
    assert.equal(process.env.GIT_CONFIG_KEY_0, undefined);
    assert.equal(process.env.GIT_CONFIG_VALUE_0, undefined);
});

test("authentication appends to inherited Git configuration only in the child environment", (t) => {
    const execute = mockGit(t);
    setEnvironment(t, {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.sslVerify",
        GIT_CONFIG_VALUE_0: "true",
        GIT_CONFIG_KEY_1: undefined,
        GIT_CONFIG_VALUE_1: undefined,
    });
    new GitClient("origin", () => "test-bitbucket-token").run(["fetch"]);
    const options = execute.mock.calls[0].arguments[2] as SpawnSyncOptions;
    assert.equal(options.env?.GIT_CONFIG_COUNT, "2");
    assert.equal(options.env?.GIT_CONFIG_KEY_0, "http.sslVerify");
    assert.equal(options.env?.GIT_CONFIG_VALUE_0, "true");
    assert.equal(options.env?.GIT_CONFIG_KEY_1, "http.extraHeader");
    assert.equal(options.env?.GIT_CONFIG_VALUE_1, "Authorization: Bearer test-bitbucket-token");
    assert.equal(process.env.GIT_CONFIG_COUNT, "1");
    assert.equal(process.env.GIT_CONFIG_KEY_1, undefined);
    assert.equal(process.env.GIT_CONFIG_VALUE_1, undefined);
});

test("explicit authentication options override automatic detection", (t) => {
    mockGit(t);
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    const client = new GitClient("origin", tokenProvider);
    client.run(["fetch"], { authenticated: false });
    assert.equal(tokenProvider.mock.callCount(), 0);
    client.run(["status"], { authenticated: true });
    assert.equal(tokenProvider.mock.callCount(), 1);
});

test("fetch uses the configured remote and requests authentication", (t) => {
    const execute = mockGit(t, { stdout: "", stderr: "" });
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    new GitClient("upstream", tokenProvider).fetch();
    assert.deepEqual(execute.mock.calls[0].arguments[1], ["fetch", "upstream"]);
    assert.equal(tokenProvider.mock.callCount(), 1);
});

test("commit history excludes merges, requests oldest first, and parses subjects and bodies without authentication", (t) => {
    const execute = mockGit(t, {
        stdout: "First commit\x1eFirst detail\r\nSecond detail\r\n\x1d\nSecond commit\x1e\x1d\n",
        stderr: "",
    });
    const tokenProvider = t.mock.fn(() => { throw new Error("Reading commit history must not request a token."); });
    const commits = new GitClient("upstream", tokenProvider).commitsBetween(
        "refs/remotes/upstream/develop", "refs/remotes/upstream/feature/test",
    );
    assert.deepEqual(commits, [
        { subject: "First commit", body: "First detail\r\nSecond detail" },
        { subject: "Second commit", body: "" },
    ]);
    assert.deepEqual(execute.mock.calls[0].arguments[1], [
        "log", "refs/remotes/upstream/develop..refs/remotes/upstream/feature/test",
        "--no-merges", "--reverse", "--format=%s%x1e%b%x1d",
    ]);
    assert.equal(tokenProvider.mock.callCount(), 0);
});

test("bb git forwards Git options and propagates the exit code without requesting a token for local commands", async (t) => {
    const execute = mockGit(t, { status: 42 });
    const tokenProvider = t.mock.fn(() => {
        throw new Error("Local Git commands must not request a token.");
    });
    const originalExitCode = process.exitCode;
    t.after(() => { process.exitCode = originalExitCode; });
    const args = ["-C", "repository with spaces", "-c", "example.setting=fetch", "status", "--short"];

    await runCli(["git", ...args], createContext(new GitClient("origin", tokenProvider)));
    assert.deepEqual(execute.mock.calls[0].arguments[1], args);
    assert.equal(tokenProvider.mock.callCount(), 0);
    assert.equal(process.exitCode, 42);
});

test("bb git authenticates remote operations", async (t) => {
    const execute = mockGit(t);
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    await runCli(["git", "-C", "repository", "fetch", "origin"], createContext(new GitClient("origin", tokenProvider)));
    assert.equal(tokenProvider.mock.callCount(), 1);
    assert.deepEqual(execute.mock.calls[0].arguments[1], ["-C", "repository", "fetch", "origin"]);
});

test("the global bb directory option is restored after a Git failure", async (t) => {
    const execute = mockGit(t, { error: new Error("Git executable unavailable") });
    const directory = mkdtempSync(join(tmpdir(), "bb-git-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const originalDirectory = process.cwd();
    const client = new GitClient("origin", () => {
        throw new Error("Local Git commands must not request a token.");
    });
    let executionDirectory: string | undefined;
    execute.mock.mockImplementation(() => {
        executionDirectory = process.cwd();
        return {
            pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
            status: null, signal: null, error: new Error("Git executable unavailable"),
        };
    });

    await assert.rejects(runCli(["-C", directory, "git", "status"], createContext(client)), (error: unknown) => {
        assert.ok(error instanceof GitCommandError);
        assert.deepEqual(error.args, ["status"]);
        assert.match(error.message, /Git executable unavailable/);
        return true;
    });
    assert.equal(executionDirectory, directory);
    assert.equal(process.cwd(), originalDirectory);
});
