import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { BitbucketClient } from "../../src/bitbucket/bitbucket-client.ts";
import type { FetchImplementation } from "../../src/bitbucket/bitbucket-client.ts";
import type { BitbucketPullRequest } from "../../src/bitbucket/bitbucket-types.ts";
import { runCli } from "../../src/cli/cli.ts";
import type { CommandContext } from "../../src/cli/command-context.ts";
import type { BbConfig } from "../../src/config/config-schema.ts";
import { GitClient } from "../../src/git/git-client.ts";
import { GitCommandError } from "../../src/git/git-command-error.ts";
import { createGitFixture } from "../helpers/git-fixture.ts";

function fixture(t: TestContext) {
    const native = createGitFixture(t);
    const config: BbConfig = {
        bitbucket: {
            url: "https://bitbucket.example:8443/context",
            projectKey: "STALE",
            defaultReviewers: [],
            sshHostnames: [],
        },
        git: { remote: "upstream" },
    };
    const repository = { name: "Payments", slug: "payments", project: { key: "REMOTE" } };
    const url = config.bitbucket.url + "/projects/REMOTE/repos/payments/pull-requests/42";
    const pr: BitbucketPullRequest = {
        id: 42,
        version: 0,
        state: "OPEN",
        reviewers: [],
        fromRef: { id: "refs/heads/feature/test", displayId: "feature/test", repository },
        toRef: { id: "refs/heads/develop", displayId: "develop", repository },
        links: { self: [{ href: url }] },
    };
    const token = t.mock.fn(() => "fixture-api-token");
    const request = t.mock.fn<FetchImplementation>(async (input, init) => {
        assert.equal(
            String(input),
            config.bitbucket.url +
                "/rest/api/latest/projects/REMOTE/repos/payments/pull-requests?state=OPEN&start=0&limit=100",
        );
        assert.equal(init?.method, "GET");
        return Response.json({ values: [pr], size: 1, start: 0, limit: 100, isLastPage: true });
    });
    const unexpected = (): never => {
        throw new Error("Unexpected dependency access.");
    };
    const git = new GitClient("upstream", unexpected, unexpected, {
        execute: (command, args, options) => {
            assert.equal(command, "git");
            assert.ok(
                (args[0] === "remote" && args[1] === "get-url") ||
                    (args[0] === "branch" && args[1] === "--show-current"),
                "Discovery must only read local Git data.",
            );
            return spawnSync(command, args, { ...options, env: native.environment });
        },
    });
    const context: CommandContext = {
        config,
        gitClient: git,
        bitbucketClient: new BitbucketClient(config.bitbucket.url, token, { fetch: request }),
        get doctor(): never {
            return unexpected();
        },
        get configStore(): never {
            return unexpected();
        },
        get tokenStore(): never {
            return unexpected();
        },
    };
    const output = t.mock.method(console, "log", () => {});
    const run = async (directory = native.nested, branches = ["feature/test", "develop"]) => {
        const originalDirectory = process.cwd();
        try {
            await runCli(["-C", directory, "get-pr-url", ...branches], context);
        } finally {
            assert.equal(process.cwd(), originalDirectory);
        }
    };
    return { ...native, config, request, token, output, url, run };
}

for (const remote of [
    "https://bitbucket.example:8443/context/scm/REMOTE/payments.git",
    "ssh://git@bitbucket.example:7999/REMOTE/payments.git",
    "git@ssh-gateway:REMOTE/payments.git",
]) {
    test("native discovery from a renamed checkout subdirectory: " + remote, async (t) => {
        const f = fixture(t);
        f.config.bitbucket.sshHostnames = ["ssh-gateway"];
        f.git(["remote", "add", "upstream", remote]);
        await f.run();
        assert.deepEqual(
            f.output.mock.calls.map((call) => call.arguments),
            [[f.url]],
        );
        assert.equal(f.request.mock.callCount(), 1);
        assert.equal(f.token.mock.callCount(), 1);
    });
}

test("native discovery uses the configured fetch remote and Git insteadOf rules", async (t) => {
    const f = fixture(t);
    f.git(["remote", "add", "origin", "https://other.example/scm/OTHER/different.git"]);
    f.git(["remote", "add", "upstream", "corp:REMOTE/payments.git"]);
    f.git(["config", "--add", "remote.upstream.url", "corp:OTHER/different.git"]);
    f.git(["config", "remote.upstream.pushurl", "ssh://git@push.example/OTHER/different.git"]);
    f.git(["config", "url.https://bitbucket.example:8443/context/scm/.insteadOf", "corp:"]);
    await f.run(f.nested, ["develop"]);
    assert.equal(f.output.mock.calls[0].arguments[0], f.url);
});

test("native discovery works in a linked worktree with a different directory name", async (t) => {
    const f = fixture(t);
    f.git([
        "remote",
        "add",
        "upstream",
        "https://bitbucket.example:8443/context/scm/REMOTE/payments.git",
    ]);
    f.git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "Fixture",
    ]);
    f.git(["worktree", "add", "--detach", "--no-checkout", "--quiet", f.worktree, "HEAD"]);
    await f.run(f.worktree);
    assert.equal(f.output.mock.calls[0].arguments[0], f.url);
});

for (const remote of [
    "https://private-user:private-password@other.example/context/scm/REMOTE/payments.git",
    "https://bitbucket.example:8443/wrong-context/scm/REMOTE/payments.git",
    "git@untrusted-gateway:REMOTE/payments.git",
    "https://private-user:private-password@bitbucket.example:8443/unsupported",
]) {
    test(
        "native discovery rejects an unsafe remote before reading credentials: " + remote,
        async (t) => {
            const f = fixture(t);
            f.git(["remote", "add", "upstream", remote]);
            await assert.rejects(f.run(), (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /remote does not match|Unable to recognize/);
                assert.doesNotMatch(error.message + error.stack, /private-user|private-password/);
                return true;
            });
            assert.equal(f.request.mock.callCount(), 0);
            assert.equal(f.token.mock.callCount(), 0);
            assert.equal(f.output.mock.callCount(), 0);
        },
    );
}

test("a missing native remote preserves its Git exit code and never uses a directory fallback", async (t) => {
    const f = fixture(t);
    await assert.rejects(f.run(), (error: unknown) => {
        assert.ok(error instanceof GitCommandError);
        assert.ok(error.exitCode !== undefined && error.exitCode > 0);
        return true;
    });
    assert.equal(f.request.mock.callCount(), 0);
    assert.equal(f.token.mock.callCount(), 0);
});
