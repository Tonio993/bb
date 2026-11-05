import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { GitClient } from "../../src/git/git-client.ts";
import { GitCommandError } from "../../src/git/git-command-error.ts";
import type { GitCommandRunner } from "../../src/git/git-types.ts";
import { createGitFixture } from "../helpers/git-fixture.ts";

const fetchUrl = "https://bitbucket.example/context/scm/PROJECT/payments.git";
const privateUrl = "https://private-user:private-token@private-server/scm/PROJECT/payments.git";

function fixture(
    t: TestContext,
    result: Partial<ReturnType<GitCommandRunner>> = {},
    remote = "upstream",
) {
    const execute = t.mock.fn<GitCommandRunner>(() => ({
        stdout: fetchUrl + "\n",
        stderr: "",
        status: 0,
        signal: null,
        ...result,
    }));
    const unexpected = (): never => {
        throw new Error("Unexpected token or Bitbucket configuration access.");
    };
    return { execute, client: new GitClient(remote, unexpected, unexpected, { execute }) };
}

test("remote URL lookup uses the configured fetch remote without authentication or network commands", (t) => {
    const { client, execute } = fixture(t);
    assert.equal(client.remoteFetchUrl(), fetchUrl);
    assert.equal(execute.mock.callCount(), 1);
    const [command, args, options] = execute.mock.calls[0].arguments;
    assert.equal(command, "git");
    assert.deepEqual(args, ["remote", "get-url", "--", "upstream"]);
    assert.equal(options.shell, false);
    assert.equal(options.stdio, "pipe");
    assert.equal(options.timeout, 10000);
    assert.equal(options.env, process.env);
});

test("an explicit remote overrides the default and is passed as a single positional argument", (t) => {
    const { client, execute } = fixture(t);
    assert.equal(client.remoteFetchUrl(" --push "), fetchUrl);
    assert.deepEqual(execute.mock.calls[0].arguments[1], ["remote", "get-url", "--", "--push"]);
});

for (const explicit of [false, true]) {
    test(`an empty ${explicit ? "explicit" : "configured"} remote fails before starting Git`, (t) => {
        const { client, execute } = fixture(t, {}, explicit ? "upstream" : " ");
        assert.throws(
            () => (explicit ? client.remoteFetchUrl(" ") : client.remoteFetchUrl()),
            /Git remote name cannot be empty/,
        );
        assert.equal(execute.mock.callCount(), 0);
    });
}

for (const status of [2, 128]) {
    test(`Git exit code ${status} is preserved without exposing stdout or stderr`, (t) => {
        const { client, execute } = fixture(t, { status, stdout: privateUrl, stderr: privateUrl });
        assert.throws(
            () => client.remoteFetchUrl(),
            (error: unknown) => {
                assert.ok(error instanceof GitCommandError);
                assert.equal(error.exitCode, status);
                assert.deepEqual(error.args, ["remote", "get-url", "--", "upstream"]);
                assert.doesNotMatch(
                    error.message + error.stack,
                    /private-user|private-token|private-server/,
                );
                assert.equal(error.cause, undefined);
                return true;
            },
        );
        assert.equal(execute.mock.callCount(), 1);
    });
}

for (const [label, result] of [
    ["spawn failure", { error: new Error(privateUrl), status: null, signal: null }],
    [
        "timeout",
        {
            error: Object.assign(new Error(privateUrl), { code: "ETIMEDOUT" }),
            status: null,
            signal: "SIGTERM",
        },
    ],
    ["signal", { status: null, signal: "SIGTERM" }],
    ["missing exit code", { status: null, signal: null }],
] satisfies [string, Partial<ReturnType<GitCommandRunner>>][]) {
    test(`remote URL lookup preserves ${label} metadata and filters native details`, (t) => {
        const { client } = fixture(t, result);
        assert.throws(
            () => client.remoteFetchUrl(),
            (error: unknown) => {
                assert.ok(error instanceof GitCommandError);
                assert.equal(error.signal, result.signal ?? undefined);
                assert.equal(error.exitCode, undefined);
                assert.doesNotMatch(
                    JSON.stringify(error) + error.stack,
                    /private-user|private-token|private-server/,
                );
                return true;
            },
        );
    });
}

test("unexpected executor exceptions cannot expose URL credentials", (t) => {
    const { client, execute } = fixture(t);
    execute.mock.mockImplementation(() => {
        throw new Error(privateUrl);
    });
    assert.throws(
        () => client.remoteFetchUrl(),
        (error: unknown) => {
            assert.ok(error instanceof GitCommandError);
            assert.doesNotMatch(
                error.message + error.stack,
                /private-user|private-token|private-server/,
            );
            return true;
        },
    );
});

test("an empty successful response is reported without outputting native diagnostics", (t) => {
    const { client } = fixture(t, { stdout: " \r\n", stderr: privateUrl });
    assert.throws(() => client.remoteFetchUrl(), /Git did not provide a fetch URL/);
});

test("raw fetch URLs remain available to the parser without retrieving a separate token", (t) => {
    const { client } = fixture(t, { stdout: privateUrl + "\n" });
    assert.equal(client.remoteFetchUrl(), privateUrl);
});

test("native Git expands insteadOf and selects the first fetch URL, independently of push URLs", (t) => {
    const { repository, outside, environment, git: run } = createGitFixture(t);
    run(["remote", "add", "upstream", "corp:PROJECT/payments.git"]);
    run(["config", "--add", "remote.upstream.url", "corp:PROJECT/another.git"]);
    run(["config", "remote.upstream.pushurl", "ssh://git@push.example/PROJECT/payments.git"]);
    run(["config", "url.https://bitbucket.example/context/scm/.insteadOf", "corp:"]);
    const unexpected = (): never => {
        throw new Error("Unexpected credentials access.");
    };
    const createClient = (cwd: string) =>
        new GitClient("upstream", unexpected, unexpected, {
            execute: (command, args, options) =>
                spawnSync(command, args, { ...options, cwd, env: environment }),
        });
    const client = createClient(repository);
    assert.equal(client.remoteFetchUrl(), fetchUrl);
    assert.throws(
        () => client.remoteFetchUrl("missing"),
        (error: unknown) => {
            assert.ok(error instanceof GitCommandError);
            assert.ok(error.exitCode !== undefined && error.exitCode !== 0);
            return true;
        },
    );
    assert.throws(
        () => createClient(outside).remoteFetchUrl(),
        (error: unknown) => {
            assert.ok(error instanceof GitCommandError);
            assert.ok(error.exitCode !== undefined && error.exitCode !== 0);
            return true;
        },
    );
});
