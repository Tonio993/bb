import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { CommanderError } from "commander";

import { runCli } from "../../src/cli/cli.ts";
import type { CommandContext } from "../../src/cli/command-context.ts";
import type { GitOperations } from "../../src/git/git-types.ts";
import { createGitStub } from "../helpers/git-stub.ts";

const mainUrl = new URL("../../src/main.ts", import.meta.url);

function createContext(gitClient?: GitOperations): CommandContext {
    return {
        get doctor(): never {
            throw new Error("Doctor must remain lazy.");
        },
        get tokenStore(): never {
            throw new Error("Token storage must remain lazy.");
        },
        get configStore(): never {
            throw new Error("Configuration must remain lazy.");
        },
        get config(): never {
            throw new Error("Configuration must remain lazy.");
        },
        get bitbucketClient(): never {
            throw new Error("Bitbucket must not be initialized.");
        },
        get gitClient() {
            assert.ok(gitClient, "Git must not be initialized.");
            return gitClient;
        },
    };
}

function captureOutput(t: TestContext) {
    let stdout = "";
    let stderr = "";
    t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
        stdout += chunk.toString();
        return true;
    });
    t.mock.method(process.stderr, "write", (chunk: string | Uint8Array) => {
        stderr += chunk.toString();
        return true;
    });
    return { read: () => ({ stdout, stderr }) };
}

function createDirectory(t: TestContext): string {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "bb cli test-")));
    const originalDirectory = process.cwd();
    t.after(() => {
        process.chdir(originalDirectory);
        rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}

for (const command of [
    [],
    ["doctor"],
    ["config"],
    ["config", "list"],
    ["config", "init"],
    ["token"],
    ["token", "set"],
    ["token", "status"],
    ["token", "delete"],
    ["git"],
    ["get-pr-url"],
    ["get-pr-urls"],
    ["create-pr"],
    ["merge-pr"],
]) {
    test(`help for '${command.join(" ") || "bb"}' returns normally without initializing clients`, async (t) => {
        const output = captureOutput(t);
        await runCli([...command, "--help"], createContext());
        const { stdout, stderr } = output.read();
        assert.ok(stdout.includes(`Usage: bb${command.length ? ` ${command.join(" ")}` : ""}`));
        assert.equal(stderr, "");
        if (command.length === 0) {
            for (const name of [
                "doctor",
                "config",
                "git",
                "get-pr-url",
                "get-pr-urls",
                "create-pr",
                "merge-pr",
            ]) {
                assert.ok(stdout.includes(name));
            }
        }
        if (command[0] === "merge-pr") {
            assert.ok(stdout.includes("--complete-tasks"));
            assert.ok(stdout.includes("--message-prefix"));
        }
        if (["get-pr-url", "create-pr", "merge-pr"].includes(command[0])) {
            assert.match(stdout, /--repository <slug>/);
        }
        if (command[0] === "doctor") {
            assert.match(stdout, /--check-token/);
            assert.match(stdout, /--remote/);
            assert.match(stdout, /Exit code: 1 if any check fails, otherwise 0/);
        }
    });
}

const invalidArguments = [
    ["get-pr-url", "feature/test", "develop", "--repository"],
    ["create-pr", "develop", "--repository"],
    ["merge-pr", "develop", "--repository"],
    ["doctor", "unexpected"],
    ["doctor", "--unknown-option"],
    ["unknown-command"],
    ["--path"],
    ["get-pr-url", "develop", "--unknown-option"],
    ["get-pr-urls", "feature/test"],
    ["config", "list", "unexpected"],
    ["config", "init", "unexpected"],
];
for (const args of invalidArguments) {
    test(`invalid arguments ${JSON.stringify(args)} throw a Commander error after one stderr diagnostic`, async (t) => {
        const output = captureOutput(t);
        await assert.rejects(runCli(args, createContext()), (error: unknown) => {
            assert.ok(error instanceof CommanderError);
            assert.equal(error.exitCode, 1);
            return true;
        });
        const { stdout, stderr } = output.read();
        assert.equal(stdout, "");
        assert.equal((stderr.match(/^error:/gm) ?? []).length, 1);
        assert.match(stderr, /run with --help/);
    });
}

test("invoking bb without a command displays help on stderr with exit code one", async (t) => {
    const output = captureOutput(t);
    await assert.rejects(runCli([], createContext()), (error: unknown) => {
        assert.ok(error instanceof CommanderError);
        assert.equal(error.exitCode, 1);
        return true;
    });
    assert.equal(output.read().stdout, "");
    assert.match(output.read().stderr, /Usage: bb/);
});

for (const option of ["-C", "--path"]) {
    test(`global ${option} changes the action directory and restores it after success`, async (t) => {
        const directory = createDirectory(t);
        const originalDirectory = process.cwd();
        let actionDirectory: string | undefined;
        const run = t.mock.fn<GitOperations["run"]>(() => {
            actionDirectory = process.cwd();
            return 0;
        });
        await runCli([option, directory, "git", "status"], createContext(createGitStub({ run })));
        assert.equal(actionDirectory, directory);
        assert.deepEqual(run.mock.calls[0].arguments, [["status"]]);
        assert.equal(process.cwd(), originalDirectory);
    });
}

test("global -C and Git -C are applied independently", async (t) => {
    const directory = createDirectory(t);
    const originalDirectory = process.cwd();
    let actionDirectory: string | undefined;
    const run = t.mock.fn<GitOperations["run"]>(() => {
        actionDirectory = process.cwd();
        return 0;
    });
    await runCli(
        ["-C", directory, "git", "-C", "nested repository", "status", "--short"],
        createContext(createGitStub({ run })),
    );
    assert.equal(actionDirectory, directory);
    assert.deepEqual(run.mock.calls[0].arguments, [
        ["-C", "nested repository", "status", "--short"],
    ]);
    assert.equal(process.cwd(), originalDirectory);
});

test("Git -C alone is forwarded without changing the bb process directory", async (t) => {
    const originalDirectory = process.cwd();
    let actionDirectory: string | undefined;
    const run = t.mock.fn<GitOperations["run"]>(() => {
        actionDirectory = process.cwd();
        return 0;
    });
    await runCli(
        ["git", "-C", "repository with spaces", "status"],
        createContext(createGitStub({ run })),
    );
    assert.equal(actionDirectory, originalDirectory);
    assert.deepEqual(run.mock.calls[0].arguments, [["-C", "repository with spaces", "status"]]);
});

for (const target of ["missing", "file", "empty"]) {
    test(`global -C rejects a ${target} path before executing the command`, async (t) => {
        const directory = createDirectory(t);
        const path = target === "empty" ? "" : join(directory, target);
        if (target === "file") writeFileSync(path, "not a directory", "utf8");
        const originalDirectory = process.cwd();
        await assert.rejects(
            runCli(["-C", path, "git", "status"], createContext()),
            /Unable to use directory/,
        );
        assert.equal(process.cwd(), originalDirectory);
    });
}

test("the executable prints parser and application errors once with a nonzero exit code", (t) => {
    const directory = createDirectory(t);
    const env = {
        ...process.env,
        APPDATA: directory,
        XDG_CONFIG_HOME: directory,
        HOME: directory,
        USERPROFILE: directory,
    };
    for (const args of [["unknown-command"], ["get-pr-url", "develop", "develop"]]) {
        const result = spawnSync(process.execPath, [fileURLToPath(mainUrl), ...args], {
            env,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.equal((result.stderr.match(/^(?:error|Error):/gm) ?? []).length, 1);
        assert.doesNotMatch(result.stderr, /at runCli|file:\/\//);
    }
});

test("the executable preserves the exit code returned by the Git pass-through", (t) => {
    const directory = createDirectory(t);
    const gitUrl = new URL("../../src/git/git-client.ts", import.meta.url);
    const script = `
        import { GitClient } from ${JSON.stringify(gitUrl.href)};
        GitClient.prototype.run = () => 37;
        process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(mainUrl))}, "git", "status"];
        await import(${JSON.stringify(mainUrl.href)});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
        env: {
            ...process.env,
            APPDATA: directory,
            XDG_CONFIG_HOME: directory,
            HOME: directory,
            USERPROFILE: directory,
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 37, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
});
