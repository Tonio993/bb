import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { TokenStore } from "../src/auth/token-store.ts";
import { runCli } from "../src/cli/cli.ts";
import type { CommandContext } from "../src/cli/command-context.ts";

function fixture(t: TestContext) {
    const environment = { BB_TOKEN: "private-environment-token" };
    const tokenStore = new TokenStore(
        {
            name: "Test secure storage",
            read(): never {
                throw new Error("Environment token must bypass storage.");
            },
            write(): never {
                throw new Error("Token writes must be mocked.");
            },
            delete(): never {
                throw new Error("Token deletion must be mocked.");
            },
        },
        environment,
    );
    const output = t.mock.method(console, "log", () => {});
    const context: CommandContext = {
        tokenStore,
        get configStore(): never {
            throw new Error("Token commands must not access application configuration.");
        },
        get config(): never {
            throw new Error("Token commands must not load required configuration.");
        },
        get bitbucketClient(): never {
            throw new Error("Token commands must not initialize Bitbucket.");
        },
        get gitClient(): never {
            throw new Error("Token commands must not initialize Git.");
        },
    };
    return { environment, tokenStore, output, context };
}

test("token status reports only the active source without configuration or clients", async (t) => {
    const { context, output } = fixture(t);
    await runCli(["token"], context);
    await runCli(["token", "status"], context);
    assert.deepEqual(
        output.mock.calls.map(({ arguments: args }) => args),
        [["Bitbucket token source: BB_TOKEN"], ["Bitbucket token source: BB_TOKEN"]],
    );
});

test("missing credentials produce a nonzero status without revealing a token", async (t) => {
    const { context, tokenStore, output } = fixture(t);
    t.mock.method(tokenStore, "source", () => undefined);
    const originalExitCode = process.exitCode;
    t.after(() => {
        process.exitCode = originalExitCode;
    });
    await runCli(["token", "status"], context);
    assert.equal(process.exitCode, 1);
    assert.match(String(output.mock.calls[0].arguments[0]), /not configured.*bb token set/);
});

test("deleting stored credentials does not modify the environment override", async (t) => {
    const { context, tokenStore, output, environment } = fixture(t);
    const remove = t.mock.method(tokenStore, "delete", () => {});
    await runCli(["token", "delete"], context);
    assert.equal(remove.mock.callCount(), 1);
    assert.equal(environment.BB_TOKEN, "private-environment-token");
    assert.deepEqual(output.mock.calls[0].arguments, ["Stored Bitbucket token deleted."]);
});

test("tokens are not accepted as positional command-line arguments", async (t) => {
    const { context, tokenStore } = fixture(t);
    const save = t.mock.method(tokenStore, "set", () => {});
    let stderr = "";
    t.mock.method(process.stderr, "write", (chunk: string | Uint8Array) => {
        stderr += chunk.toString();
        return true;
    });
    await assert.rejects(
        runCli(["token", "set", "private-positional-token"], context),
        /Invalid token command arguments/,
    );
    assert.equal(save.mock.callCount(), 0);
    assert.ok(!stderr.includes("private-positional-token"));
});

test("token set --stdin reads the pipe and reports success without echoing its contents", () => {
    const storeUrl = new URL("../src/auth/token-store.ts", import.meta.url);
    const mainUrl = new URL("../src/main.ts", import.meta.url);
    const script = `
        import { TokenStore } from ${JSON.stringify(storeUrl.href)};
        TokenStore.prototype.set = (value) => {
            if (value.trim() !== "private-input-token") throw new Error("Unexpected input.");
        };
        process.argv = [process.execPath, "bb", "token", "set", "--stdin"];
        await import(${JSON.stringify(mainUrl.href)});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
        input: "private-input-token\n",
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "Bitbucket token saved.");
    assert.equal(result.stderr, "");
});
