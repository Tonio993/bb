import assert from "node:assert/strict";
import childProcess from "node:child_process";
import type { SpawnSyncOptions } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../../src/cli/cli.ts";
import type { CommandContext } from "../../src/cli/command-context.ts";
import { GitClient } from "../../src/git/git-client.ts";
import { type GitCommandRunner } from "../../src/git/git-types.ts";
import { GitCommandError } from "../../src/git/git-command-error.ts";

function mockGit(t: TestContext, result: Partial<ReturnType<GitCommandRunner>> = {}) {
    return t.mock.fn<GitCommandRunner>(() => ({
        stdout: "",
        stderr: "",
        status: 0,
        signal: null,
        ...result,
    }));
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
        get doctor(): never {
            throw new Error("Doctor must remain lazy.");
        },
        get tokenStore(): never {
            throw new Error("Token storage is already injected in Git.");
        },
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

test("Git version is bounded and does not request configuration or credentials", (t) => {
    const execute = mockGit(t, { stdout: "git version 2.50.0\n" });
    const unexpected = (): never => {
        throw new Error("Unexpected credential or configuration access.");
    };
    const client = new GitClient("origin", unexpected, unexpected, { execute });
    assert.equal(client.version(), "git version 2.50.0");
    const [command, args, options] = execute.mock.calls[0].arguments;
    assert.equal(command, "git");
    assert.deepEqual(args, ["--version"]);
    assert.equal(options.timeout, 10000);
    assert.equal(options.shell, false);
});

test("Git clients keep their injected process runners isolated", (t) => {
    const first = mockGit(t, { stdout: "feature/first\n" });
    const second = mockGit(t, { stdout: "feature/second\n" });
    const token = (): never => {
        throw new Error("Local operations must not request credentials.");
    };
    const firstClient = new GitClient("origin", token, () => undefined, { execute: first });
    const secondClient = new GitClient("origin", token, () => undefined, { execute: second });
    assert.equal(firstClient.currentBranch(), "feature/first");
    assert.equal(secondClient.currentBranch(), "feature/second");
    assert.equal(first.mock.callCount(), 1);
    assert.equal(second.mock.callCount(), 1);
});

for (const branchType of ["source", "target"]) {
    test(`missing remote ${branchType} branches retain their role and configured remote in diagnostics`, (t) => {
        const execute = mockGit(t, { status: 1 });
        const token = (): never => {
            throw new Error("Branch checks must not request credentials.");
        };
        const client = new GitClient("origin", token, () => undefined, { execute });
        assert.throws(
            () => client.assertRemoteBranchExists("feature/test", branchType, "upstream"),
            {
                message: `Remote ${branchType} branch 'upstream/feature/test' does not exist.`,
            },
        );
        assert.deepEqual(execute.mock.calls[0].arguments[1], [
            "show-ref",
            "--verify",
            "--quiet",
            "refs/remotes/upstream/feature/test",
        ]);
    });
}

test("local Git commands do not request a token, including remote command names used as arguments", (t) => {
    const execute = mockGit(t);
    const tokenProvider = t.mock.fn(() => {
        throw new Error("Local Git commands must not request a token.");
    });
    const client = new GitClient(
        "origin",
        tokenProvider,
        () => {
            throw new Error("Local Git commands must not read the Bitbucket URL.");
        },
        { execute },
    );
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
    assert.deepEqual(
        execute.mock.calls.map(({ arguments: args }) => args[1]),
        commands,
    );
});

test("remote Git commands receive authentication after Git global options without changing arguments", (t) => {
    const execute = mockGit(t);
    setEnvironment(t, {
        GIT_CONFIG_COUNT: undefined,
        GIT_CONFIG_KEY_0: undefined,
        GIT_CONFIG_VALUE_0: undefined,
    });
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    const client = new GitClient("origin", tokenProvider, () => "https://bitbucket.example", {
        execute,
    });
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
        assert.equal(
            spawnOptions.env?.GIT_CONFIG_KEY_0,
            "http.https://bitbucket.example/.extraHeader",
        );
        assert.equal(
            spawnOptions.env?.GIT_CONFIG_VALUE_0,
            "Authorization: Bearer test-bitbucket-token",
        );
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
    new GitClient(
        "origin",
        () => "test-bitbucket-token",
        () => "https://bitbucket.example",
        { execute },
    ).run(["fetch"]);
    const options = execute.mock.calls[0].arguments[2] as SpawnSyncOptions;
    assert.equal(options.env?.GIT_CONFIG_COUNT, "2");
    assert.equal(options.env?.GIT_CONFIG_KEY_0, "http.sslVerify");
    assert.equal(options.env?.GIT_CONFIG_VALUE_0, "true");
    assert.equal(options.env?.GIT_CONFIG_KEY_1, "http.https://bitbucket.example/.extraHeader");
    assert.equal(options.env?.GIT_CONFIG_VALUE_1, "Authorization: Bearer test-bitbucket-token");
    assert.equal(process.env.GIT_CONFIG_COUNT, "1");
    assert.equal(process.env.GIT_CONFIG_KEY_1, undefined);
    assert.equal(process.env.GIT_CONFIG_VALUE_1, undefined);
});

test("explicit authentication options override automatic detection", (t) => {
    const execute = mockGit(t);
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    const client = new GitClient("origin", tokenProvider, () => "https://bitbucket.example", {
        execute,
    });
    client.run(["fetch"], { authenticated: false });
    assert.equal(tokenProvider.mock.callCount(), 0);
    client.run(["status"], { authenticated: true });
    assert.equal(tokenProvider.mock.callCount(), 1);
});

test("fetch uses the configured remote and requests authentication", (t) => {
    const execute = mockGit(t, { stdout: "", stderr: "" });
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    new GitClient("upstream", tokenProvider, () => "https://bitbucket.example", {
        execute,
    }).fetch();
    assert.deepEqual(execute.mock.calls[0].arguments[1], ["fetch", "upstream"]);
    assert.equal(tokenProvider.mock.callCount(), 1);
});

test("commit history excludes merges, requests oldest first, and parses subjects and bodies without authentication", (t) => {
    const execute = mockGit(t, {
        stdout: "First commit\x1eFirst detail\r\nSecond detail\r\n\x1d\nSecond commit\x1e\x1d\n",
        stderr: "",
    });
    const tokenProvider = t.mock.fn(() => {
        throw new Error("Reading commit history must not request a token.");
    });
    const commits = new GitClient(
        "upstream",
        tokenProvider,
        () => {
            throw new Error("Local Git must not read the Bitbucket URL.");
        },
        { execute },
    ).commitsBetween("refs/remotes/upstream/develop", "refs/remotes/upstream/feature/test");
    assert.deepEqual(commits, [
        { subject: "First commit", body: "First detail\r\nSecond detail" },
        { subject: "Second commit", body: "" },
    ]);
    assert.deepEqual(execute.mock.calls[0].arguments[1], [
        "log",
        "refs/remotes/upstream/develop..refs/remotes/upstream/feature/test",
        "--no-merges",
        "--reverse",
        "--format=%s%x1e%b%x1d",
    ]);
    assert.equal(tokenProvider.mock.callCount(), 0);
});

test("bb git forwards Git options and propagates the exit code without requesting a token for local commands", async (t) => {
    const execute = mockGit(t, { status: 42 });
    const tokenProvider = t.mock.fn(() => {
        throw new Error("Local Git commands must not request a token.");
    });
    const originalExitCode = process.exitCode;
    t.after(() => {
        process.exitCode = originalExitCode;
    });
    const args = [
        "-C",
        "repository with spaces",
        "-c",
        "example.setting=fetch",
        "status",
        "--short",
    ];

    await runCli(
        ["git", ...args],
        createContext(
            new GitClient(
                "origin",
                tokenProvider,
                () => {
                    throw new Error("Local Git must not read the Bitbucket URL.");
                },
                { execute },
            ),
        ),
    );
    assert.deepEqual(execute.mock.calls[0].arguments[1], args);
    assert.equal(tokenProvider.mock.callCount(), 0);
    assert.equal(process.exitCode, 42);
});

test("bb git authenticates remote operations", async (t) => {
    const execute = mockGit(t);
    const tokenProvider = t.mock.fn(() => "test-bitbucket-token");
    await runCli(
        ["git", "-C", "repository", "fetch", "origin"],
        createContext(
            new GitClient("origin", tokenProvider, () => "https://bitbucket.example", { execute }),
        ),
    );
    assert.equal(tokenProvider.mock.callCount(), 1);
    assert.deepEqual(execute.mock.calls[0].arguments[1], ["-C", "repository", "fetch", "origin"]);
});

test("the global bb directory option is restored after a Git failure", async (t) => {
    const execute = mockGit(t, { error: new Error("Git executable unavailable") });
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "bb-git-test-")));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const originalDirectory = process.cwd();
    const client = new GitClient(
        "origin",
        () => {
            throw new Error("Local Git commands must not request a token.");
        },
        () => {
            throw new Error("Local Git must not read the Bitbucket URL.");
        },
        { execute },
    );
    let executionDirectory: string | undefined;
    execute.mock.mockImplementation(() => {
        executionDirectory = process.cwd();
        return {
            pid: 1,
            output: [],
            stdout: "",
            stderr: "",
            status: null,
            signal: null,
            error: new Error("Git executable unavailable"),
        };
    });

    await assert.rejects(
        runCli(["-C", directory, "git", "status"], createContext(client)),
        (error: unknown) => {
            assert.ok(error instanceof GitCommandError);
            assert.deepEqual(error.args, ["status"]);
            assert.match(error.message, /Git executable unavailable/);
            return true;
        },
    );
    assert.equal(executionDirectory, directory);
    assert.equal(process.cwd(), originalDirectory);
});

for (const method of ["localBranchExists", "remoteBranchExists"] as const) {
    for (const exitCode of [0, 1]) {
        test(`${method} distinguishes an existing branch from an absent branch (exit ${exitCode})`, (t) => {
            const execute = mockGit(t, { status: exitCode });
            const client = new GitClient(
                "upstream",
                () => {
                    throw new Error("Branch checks must not request a token.");
                },
                () => {
                    throw new Error("Branch checks must not read the Bitbucket URL.");
                },
                { execute },
            );
            assert.equal(client[method]("feature/test"), exitCode === 0);
            assert.deepEqual(execute.mock.calls[0].arguments[1], [
                "show-ref",
                "--verify",
                "--quiet",
                method === "localBranchExists"
                    ? "refs/heads/feature/test"
                    : "refs/remotes/upstream/feature/test",
            ]);
        });
    }

    test(`${method} preserves Git failures instead of reporting a missing branch`, (t) => {
        const execute = mockGit(t, { status: 128, stderr: "fatal: not a git repository\n" });
        const client = new GitClient(
            "origin",
            () => "unused",
            () => "https://bitbucket.example",
            { execute },
        );
        assert.throws(
            () => client[method]("main"),
            (error: unknown) => {
                assert.ok(error instanceof GitCommandError);
                assert.equal(error.exitCode, 128);
                assert.match(error.message, /not a git repository/);
                assert.equal(error.args[0], "show-ref");
                return true;
            },
        );
    });
}

const operations = [
    {
        name: "pass-through",
        args: ["status"],
        execute: (client: GitClient) => client.run(["status"]),
    },
    {
        name: "capture",
        args: ["branch", "--show-current"],
        execute: (client: GitClient) => client.currentBranch(),
    },
    {
        name: "branch check",
        args: ["show-ref", "--verify", "--quiet", "refs/heads/main"],
        execute: (client: GitClient) => client.localBranchExists("main"),
    },
];
const failures: {
    name: string;
    result: Partial<ReturnType<GitCommandRunner>>;
    message: RegExp;
}[] = [
    {
        name: "spawn failure",
        result: { status: null, error: new Error("Git executable unavailable") },
        message: /Git executable unavailable/,
    },
    {
        name: "signal",
        result: { status: null, signal: "SIGTERM" },
        message: /terminated by signal SIGTERM/,
    },
    { name: "missing exit code", result: { status: null }, message: /without an exit code/ },
    {
        name: "capture overflow",
        result: {
            status: null,
            error: Object.assign(new Error("spawnSync git ENOBUFS"), { code: "ENOBUFS" }),
        },
        message: /16 MiB capture limit/,
    },
];
for (const operation of operations) {
    for (const failure of failures) {
        test(`${operation.name} reports ${failure.name} as a structured Git error`, (t) => {
            const execute = mockGit(t, failure.result);
            const client = new GitClient(
                "origin",
                () => "unused",
                () => "https://bitbucket.example",
                { execute },
            );
            assert.throws(
                () => operation.execute(client),
                (error: unknown) => {
                    assert.ok(error instanceof GitCommandError);
                    assert.deepEqual(error.args, operation.args);
                    assert.equal(error.exitCode, undefined);
                    assert.equal(error.signal, failure.result.signal ?? undefined);
                    assert.match(error.message, failure.message);
                    return true;
                },
            );
        });
    }
}

test("capture preserves a failed command's exit code and uses a useful fallback without stderr", (t) => {
    const execute = mockGit(t, { status: 42 });
    const client = new GitClient(
        "origin",
        () => "unused",
        () => "https://bitbucket.example",
        { execute },
    );
    assert.throws(
        () => client.currentBranch(),
        (error: unknown) => {
            assert.ok(error instanceof GitCommandError);
            assert.equal(error.exitCode, 42);
            assert.match(error.message, /exit code 42/);
            return true;
        },
    );
});

test("commit history supports output larger than the default process capture buffer", (t) => {
    const body = "x".repeat(2 * 1024 * 1024);
    const output = `Title\x1e${body}\x1d`;
    const execute = mockGit(t, { stdout: output, stderr: "" });
    const client = new GitClient(
        "origin",
        () => "unused",
        () => "https://bitbucket.example",
        { execute },
    );
    assert.deepEqual(client.commitsBetween("target", "source"), [{ subject: "Title", body }]);
    const options = execute.mock.calls[0].arguments[2] as SpawnSyncOptions;
    assert.ok(options.maxBuffer! >= Buffer.byteLength(output));
    assert.equal(options.maxBuffer, 16 * 1024 * 1024);
});

for (const [url, key] of [
    [
        " https://BITBUCKET.example/bitbucket/// ",
        "http.https://bitbucket.example/bitbucket/.extraHeader",
    ],
    [
        "https://bitbucket.example:8443/bitbucket",
        "http.https://bitbucket.example:8443/bitbucket/.extraHeader",
    ],
    ["http://bitbucket.example", "http.http://bitbucket.example/.extraHeader"],
]) {
    test(`authentication is scoped to the configured URL ${url.trim()}`, (t) => {
        const execute = mockGit(t);
        setEnvironment(t, { GIT_CONFIG_COUNT: undefined });
        const client = new GitClient(
            "origin",
            () => "test-token",
            () => url,
            { execute },
        );
        client.run(["clone", "https://another.example/repo.git"]);
        const options = execute.mock.calls[0].arguments[2] as SpawnSyncOptions;
        assert.equal(options.env?.GIT_CONFIG_KEY_0, key);
        assert.equal(options.env?.GIT_CONFIG_VALUE_0, "Authorization: Bearer test-token");
        assert.deepEqual(execute.mock.calls[0].arguments[1], [
            "clone",
            "https://another.example/repo.git",
        ]);
    });
}

for (const url of [
    undefined,
    "",
    "not a URL",
    "ssh://bitbucket.example",
    "https://*.example",
    "https://user:password@bitbucket.example",
    "https://bitbucket.example?query=1",
    "https://bitbucket.example#fragment",
]) {
    test(`missing or unsafe authentication URL ${JSON.stringify(url)} fails before reading the token`, (t) => {
        const execute = mockGit(t);
        setEnvironment(t, { GIT_CONFIG_COUNT: undefined });
        const token = t.mock.fn(() => "test-token");
        const client = new GitClient("origin", token, () => url, { execute });
        assert.throws(() => client.run(["fetch"]), /[Bb]itbucket/);
        assert.equal(token.mock.callCount(), 0);
        assert.equal(execute.mock.callCount(), 0);
    });
}

for (const value of [
    "",
    "-1",
    "+1",
    " 1",
    "1 ",
    "1.5",
    "2extra",
    "1e2",
    "NaN",
    "Infinity",
    "9007199254740991",
]) {
    test(`invalid inherited GIT_CONFIG_COUNT ${JSON.stringify(value)} is rejected without overwriting entries`, (t) => {
        const execute = mockGit(t);
        setEnvironment(t, {
            GIT_CONFIG_COUNT: value,
            GIT_CONFIG_KEY_0: "example.setting",
            GIT_CONFIG_VALUE_0: "keep",
        });
        const token = t.mock.fn(() => "test-token");
        const client = new GitClient("origin", token, () => "https://bitbucket.example", {
            execute,
        });
        assert.throws(() => client.run(["fetch"]), /Invalid GIT_CONFIG_COUNT/);
        assert.equal(execute.mock.callCount(), 0);
        assert.equal(token.mock.callCount(), 0);
        assert.equal(process.env.GIT_CONFIG_COUNT, value);
        assert.equal(process.env.GIT_CONFIG_KEY_0, "example.setting");
        assert.equal(process.env.GIT_CONFIG_VALUE_0, "keep");
    });
}

for (const authenticated of [false, true]) {
    test(`the bootstrap runs ${authenticated ? "remote Git with only bitbucket.url" : "local Git without Bitbucket configuration"}`, (t) => {
        const directory = mkdtempSync(join(tmpdir(), "bb-git-bootstrap-"));
        t.after(() => rmSync(directory, { recursive: true, force: true }));
        const configDirectory =
            process.platform === "darwin"
                ? join(directory, "Library", "Application Support", "bb")
                : join(directory, "bb");
        mkdirSync(configDirectory, { recursive: true });
        writeFileSync(
            join(configDirectory, "config.json"),
            JSON.stringify(
                authenticated ? { bitbucket: { url: "https://bitbucket.example/bitbucket" } } : {},
            ),
        );
        const mainUrl = new URL("../../src/main.ts", import.meta.url);
        const script = `
            import assert from "node:assert/strict";
            import childProcess from "node:child_process";
            import { syncBuiltinESMExports } from "node:module";
            let calls = 0;
            childProcess.spawnSync = (command, args, options) => {
                calls++;
                assert.equal(command, "git");
                assert.deepEqual(args, ${JSON.stringify(authenticated ? ["fetch", "origin"] : ["status"])});
                assert.equal(options.env.GIT_CONFIG_COUNT, ${JSON.stringify(authenticated ? "1" : "0")});
                if (${authenticated}) {
                    assert.equal(options.env.GIT_CONFIG_KEY_0, "http.https://bitbucket.example/bitbucket/.extraHeader");
                    assert.equal(options.env.GIT_CONFIG_VALUE_0, "Authorization: Bearer bootstrap-test-token");
                }
                return { pid: 1, output: [], stdout: null, stderr: null, status: 0, signal: null };
            };
            syncBuiltinESMExports();
            process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(mainUrl))}, "git", ...${JSON.stringify(authenticated ? ["fetch", "origin"] : ["status"])}];
            await import(${JSON.stringify(mainUrl.href)});
            assert.equal(calls, 1);
        `;
        const result = childProcess.spawnSync(
            process.execPath,
            ["--input-type=module", "--eval", script],
            {
                env: {
                    ...process.env,
                    APPDATA: directory,
                    XDG_CONFIG_HOME: directory,
                    HOME: directory,
                    USERPROFILE: directory,
                    GIT_CONFIG_COUNT: "0",
                    BB_TOKEN: authenticated ? "bootstrap-test-token" : "",
                },
                encoding: "utf8",
                windowsHide: true,
                timeout: 15000,
            },
        );
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
    });
}
