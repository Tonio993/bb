import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../../../src/cli/cli.ts";
import type { CommandContext } from "../../../src/cli/command-context.ts";
import { ConfigStore } from "../../../src/config/config-store.ts";

const entryPoint = fileURLToPath(new URL("../../../src/main.ts", import.meta.url));

function createFixture(t: TestContext) {
    const directory = mkdtempSync(join(tmpdir(), "bb-config-cli-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const configDirectory =
        process.platform === "darwin"
            ? join(directory, "Library", "Application Support")
            : directory;
    const store = new ConfigStore(join(configDirectory, "bb", "config.json"));
    const env = {
        ...process.env,
        APPDATA: directory,
        XDG_CONFIG_HOME: directory,
        HOME: directory,
        USERPROFILE: directory,
    };

    return { store, env };
}

test("config list, read, and write work without resolving application clients or required configuration", async (t) => {
    const { store } = createFixture(t);
    const output = t.mock.method(console, "log", () => {});
    const context: CommandContext = {
        get doctor(): never {
            throw new Error("Doctor must remain lazy.");
        },
        get tokenStore(): never {
            throw new Error("Token storage must remain lazy.");
        },
        configStore: store,
        get config(): never {
            throw new Error("Required configuration must remain lazy.");
        },
        get gitClient(): never {
            throw new Error("Git must not be initialized.");
        },
        get bitbucketClient(): never {
            throw new Error("Bitbucket must not be initialized.");
        },
    };

    await runCli(["config"], context);
    assert.ok(output.mock.calls.some(({ arguments: args }) => args[0] === "git.remote = origin"));
    assert.equal(store.exists(), false);

    output.mock.resetCalls();
    await runCli(["config", "bitbucket.url", "https://bitbucket.company.com/"], context);
    assert.deepEqual(
        output.mock.calls.map(({ arguments: args }) => args),
        [["bitbucket.url = https://bitbucket.company.com"]],
    );

    output.mock.resetCalls();
    await runCli(["config", "bitbucket.url"], context);
    assert.deepEqual(
        output.mock.calls.map(({ arguments: args }) => args),
        [["https://bitbucket.company.com"]],
    );

    const snapshots = t.mock.method(store, "snapshot");
    t.mock.method(store, "get", () => {
        throw new Error("Listing must use a single snapshot.");
    });
    for (const args of [["config"], ["config", "list"]]) {
        snapshots.mock.resetCalls();
        await runCli(args, context);
        assert.equal(snapshots.mock.callCount(), 1);
    }
    await assert.rejects(runCli(["config", "unknown.key"], context), /Available keys:/);
});

test("help works with an unreadable configuration and configuration errors use the CLI error handler", (t) => {
    const { store, env } = createFixture(t);
    mkdirSync(dirname(store.path), { recursive: true });
    writeFileSync(store.path, "{", "utf8");
    const options = { env, encoding: "utf8", windowsHide: true, timeout: 15000 } as const;

    const help = spawnSync(process.execPath, [entryPoint, "--help"], options);
    assert.ifError(help.error);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage: bb/);
    assert.equal(help.stderr, "");

    const result = spawnSync(process.execPath, [entryPoint, "config", "list"], options);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.startsWith("Error: Unable to read configuration file"));
    assert.ok(result.stderr.includes(store.path));
    assert.doesNotMatch(result.stderr, /at ConfigStore|file:\/\//);
});

async function initialize(
    env: NodeJS.ProcessEnv,
    answers: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [entryPoint, "config", "init"], {
            env,
            windowsHide: true,
            timeout: 15000,
        });
        const prompts = [
            "Bitbucket URL",
            "Bitbucket project key",
            "Default reviewers",
            "Git remote",
        ];
        let stdout = "";
        let stderr = "";
        let answerIndex = 0;
        let cursor = 0;

        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
            const prompt = prompts[answerIndex];
            if (prompt === undefined) {
                return;
            }

            const position = stdout.indexOf(prompt, cursor);
            if (position >= 0) {
                cursor = position + prompt.length;
                child.stdin.write(`${answers[answerIndex]}\n`);
                answerIndex++;
            }
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

test("config init works from an empty configuration and Enter preserves existing defaults", async (t) => {
    const { store, env } = createFixture(t);
    const first = await initialize(env, [
        " HTTPS://BITBUCKET.company.com:443/// ",
        " PROJECT ",
        " mario, , luca, ",
        " upstream ",
    ]);
    assert.equal(first.code, 0, first.stderr || first.stdout);
    assert.equal(first.stderr, "");
    assert.match(first.stdout, /Configuration saved successfully/);

    const expected = {
        bitbucket: {
            url: "https://bitbucket.company.com",
            projectKey: "PROJECT",
            defaultReviewers: ["mario", "luca"],
            sshHostnames: [],
        },
        git: { remote: "upstream" },
    };
    assert.deepEqual(store.loadRequired(), expected);

    const second = await initialize(env, ["", "", "", ""]);
    assert.equal(second.code, 0, second.stderr || second.stdout);
    assert.equal(second.stderr, "");
    for (const value of ["https://bitbucket.company.com", "PROJECT", "mario,luca", "upstream"]) {
        assert.ok(second.stdout.includes(`[${value}]`));
    }
    assert.deepEqual(store.loadRequired(), expected);
});

test("config init permits an omitted project and preserves trusted SSH hostnames", async (t) => {
    const { store, env } = createFixture(t);
    store.set("bitbucket.sshHostnames", "SSH-GATEWAY");
    const result = await initialize(env, ["https://bitbucket.company.com", "", "", ""]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const config = store.loadRequired();
    assert.equal(config.bitbucket.projectKey, undefined);
    assert.deepEqual(config.bitbucket.sshHostnames, ["ssh-gateway"]);
});
