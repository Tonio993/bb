import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { BitbucketClient, type FetchImplementation } from "../../src/bitbucket/bitbucket-client.ts";
import { BitbucketApiError } from "../../src/bitbucket/bitbucket-api-error.ts";
import type { BitbucketPullRequest } from "../../src/bitbucket/bitbucket-types.ts";
import { runCli } from "../../src/cli/cli.ts";
import type { CommandContext } from "../../src/cli/command-context.ts";
import type { JsonResult, PullRequestOutput } from "../../src/cli/json-output-types.ts";
import type { DoctorCheck } from "../../src/application/doctor/doctor-types.ts";
import type { BbConfig } from "../../src/config/config-schema.ts";
import { GitCommandError } from "../../src/git/git-command-error.ts";
import { createGitStub } from "../helpers/git-stub.ts";

function fixture(t: TestContext) {
    const previousExitCode = process.exitCode;
    t.after(() => {
        process.exitCode = previousExitCode;
    });
    const output = t.mock.method(console, "log", () => {});
    const stderr: string[] = [];
    t.mock.method(process.stderr, "write", (value: string | Uint8Array) => {
        stderr.push(value.toString());
        return true;
    });
    const config: BbConfig = {
        bitbucket: {
            url: "https://bitbucket.example/context",
            projectKey: "PROJECT",
            defaultReviewers: [],
            sshHostnames: [],
        },
        git: { remote: "origin" },
    };
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    const pr: BitbucketPullRequest = {
        id: 42,
        version: 7,
        state: "OPEN",
        reviewers: [{ status: "APPROVED" }],
        fromRef: {
            id: "refs/heads/feature/test",
            displayId: "feature/test",
            repository,
            latestCommit: "a".repeat(40),
        },
        toRef: { id: "refs/heads/develop", displayId: "develop", repository },
        links: {
            self: [
                {
                    href: "https://bitbucket.example/context/projects/PROJECT/repos/payments/pull-requests/42",
                },
            ],
        },
    };
    const checks: DoctorCheck[] = [
        { name: "Node", status: "OK", message: "Node is available." },
        { name: "Optional tool", status: "WARN", message: "An optional tool is unavailable." },
        { name: "Token", status: "SKIP", message: "Token reading was not requested." },
    ];
    const state = { empty: false, deletionStatus: 0, mergeStatus: 0 };
    const requests: { method: string; path: string }[] = [];
    const page = (values: unknown[]) => ({
        values,
        size: values.length,
        start: 0,
        limit: 100,
        isLastPage: true,
    });
    const payload = () => ({
        ...pr,
        token: "private-response-marker",
        description: "private-response-marker",
    });
    const request = t.mock.fn<FetchImplementation>(async (input, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        requests.push({ method, path });
        if (method === "DELETE")
            return state.deletionStatus
                ? Response.json(
                      { errors: [{ message: "private-response-marker" }] },
                      { status: state.deletionStatus },
                  )
                : new Response(null, { status: 204 });
        if (method === "POST" && path.endsWith("/merge"))
            return state.mergeStatus
                ? Response.json(
                      { errors: [{ message: "private-response-marker" }] },
                      { status: state.mergeStatus },
                  )
                : Response.json({ ...payload(), state: "MERGED" });
        if (method === "POST") return Response.json(payload(), { status: 201 });
        if (path.endsWith("/repos")) return Response.json(page(state.empty ? [] : [repository]));
        if (path.endsWith("/pull-requests"))
            return Response.json(page(state.empty ? [] : [payload()]));
        if (path.endsWith("/42/blocker-comments")) return Response.json(page([]));
        if (path.endsWith("/commit-message-suggestion"))
            return Response.json({ title: "Merge", body: "Changes" });
        if (path.endsWith("/42")) return Response.json(payload());
        throw new Error("Unexpected request.");
    });
    const git = createGitStub({
        currentBranch: () => "feature/test",
        remoteFetchUrl: () => "https://bitbucket.example/context/scm/PROJECT/payments.git",
        fetch: () => {},
        assertRemoteBranchExists: () => {},
        commitsBetween: () => [{ subject: "Title", body: "Body" }],
    });
    const context: CommandContext = {
        config,
        gitClient: git,
        bitbucketClient: new BitbucketClient(
            config.bitbucket.url,
            () => "private-response-marker",
            { fetch: request },
        ),
        doctor: async () => checks,
        get configStore(): never {
            throw new Error("Unexpected private-response-marker access.");
        },
        get tokenStore(): never {
            throw new Error("Unexpected private-response-marker access.");
        },
    };
    const read = () => {
        assert.equal(output.mock.callCount(), 1, "Expected exactly one JSON document.");
        const raw = String(output.mock.calls[0].arguments[0]);
        assert.doesNotMatch(raw, /private-response-marker/);
        assert.equal(stderr.join(""), "");
        const result = JSON.parse(raw) as JsonResult<Record<string, unknown>>;
        assert.equal(result.schemaVersion, 1);
        assert.equal(result.ok, result.error === null);
        assert.equal(result.exitCode, process.exitCode ?? 0);
        return result;
    };
    return {
        config,
        pr,
        checks,
        state,
        requests,
        request,
        git,
        context,
        output,
        stderr,
        read,
        run: (args: string[]) => runCli(args, context),
    };
}

const commands = [
    ["get-pr-url", "feature/test", "develop"],
    ["get-pr-urls", "feature/test", "develop"],
    ["create-pr", "feature/test", "develop"],
    ["merge-pr", "feature/test", "develop"],
    ["doctor"],
];
for (const args of commands) {
    for (const global of [false, true]) {
        test(`${args[0]} emits a JSON envelope with ${global ? "global" : "local"} --json`, async (t) => {
            const f = fixture(t);
            await f.run(global ? ["--json", ...args] : [...args, "--json"]);
            const result = f.read();
            assert.equal(result.command, args[0]);
            assert.equal(result.ok, true);
            if (args[0] === "get-pr-urls")
                assert.equal((result.data?.pullRequests as unknown[]).length, 1);
            else if (args[0] === "doctor")
                assert.deepEqual(result.data?.summary, { OK: 1, WARN: 1, FAIL: 0, SKIP: 1 });
            else assert.equal((result.data?.pullRequest as PullRequestOutput).id, 42);
        });
    }
}

for (const command of ["get-pr-url", "get-pr-urls"]) {
    test(command + " represents empty results explicitly", async (t) => {
        const f = fixture(t);
        f.state.empty = true;
        await f.run([command, "feature/test", "develop", "--json"]);
        const result = f.read();
        assert.deepEqual(
            result.data,
            command === "get-pr-url" ? { pullRequest: null } : { pullRequests: [] },
        );
        assert.equal(result.ok, true);
    });
}

test("JSON projections omit extra response fields and credentials in links", async (t) => {
    const f = fixture(t);
    f.pr.links.self[0].href =
        "https://private-response-marker:private-response-marker@bitbucket.example/pr/42?token=private-response-marker#private-response-marker";
    await f.run(["get-pr-url", "feature/test", "develop", "--json"]);
    const result = f.read();
    const pr = result.data!.pullRequest as PullRequestOutput;
    assert.equal(pr.url, "https://bitbucket.example/pr/42");
    assert.deepEqual(Object.keys(pr).sort(), [
        "id",
        "reviewers",
        "source",
        "state",
        "target",
        "url",
        "version",
    ]);
});

test("doctor failures retain checks and summary in a failing JSON envelope", async (t) => {
    const f = fixture(t);
    f.checks.push({ name: "Configuration", status: "FAIL", message: "Invalid configuration." });
    await f.run(["doctor", "--json"]);
    const result = f.read();
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "DIAGNOSTIC_FAILED");
    assert.deepEqual(result.data?.summary, { OK: 1, WARN: 1, FAIL: 1, SKIP: 1 });
});

test("a failed source deletion retains the confirmed merge in JSON", async (t) => {
    const f = fixture(t);
    f.state.deletionStatus = 403;
    await f.run(["merge-pr", "feature/test", "develop", "--delete-source", "--json"]);
    const result = f.read();
    assert.equal(result.data?.sourceDeletion, "failed");
    assert.equal((result.data?.pullRequest as PullRequestOutput).state, "MERGED");
    assert.equal(result.error?.code, "SOURCE_DELETION_FAILED");
    assert.equal(result.error?.cause?.code, "ACCESS_DENIED");
    assert.equal(result.error?.cause?.httpStatus, 403);
    assert.equal(f.requests.filter(({ method }) => method === "POST").length, 1);
});

test("a partial merge retains its identity even without a PR link", async (t) => {
    const f = fixture(t);
    f.state.deletionStatus = 403;
    f.pr.links.self = [];
    await f.run(["merge-pr", "feature/test", "develop", "--delete-source", "--json"]);
    const result = f.read();
    assert.equal((result.data?.pullRequest as PullRequestOutput).id, 42);
    assert.equal((result.data?.pullRequest as PullRequestOutput).url, null);
    assert.equal(result.error?.code, "SOURCE_DELETION_FAILED");
});

test("a successful source deletion is explicit in JSON", async (t) => {
    const f = fixture(t);
    await f.run(["merge-pr", "feature/test", "develop", "--delete-source", "--json"]);
    assert.equal(f.read().data?.sourceDeletion, "deleted");
});

for (const [status, code] of [
    [401, "AUTHENTICATION_FAILED"],
    [403, "ACCESS_DENIED"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [429, "RATE_LIMITED"],
    [503, "BITBUCKET_UNAVAILABLE"],
] as const) {
    test("HTTP " + status + " emits a stable JSON error without server messages", async (t) => {
        const f = fixture(t);
        f.state.mergeStatus = status;
        await f.run(["--json", "merge-pr", "feature/test", "develop"]);
        const result = f.read();
        assert.equal(result.error?.code, code);
        assert.equal(result.error?.httpStatus, status);
        assert.equal(result.error?.method, "POST");
        assert.equal(result.data, null);
    });
}

for (const error of [
    new Error("private-response-marker"),
    new GitCommandError("private-response-marker", {
        exitCode: 128,
        args: ["private-response-marker"],
    }),
    new BitbucketApiError("private-response-marker", { kind: "timeout", method: "GET" }),
    new BitbucketApiError("private-response-marker", { kind: "connection", method: "GET" }),
    new BitbucketApiError("private-response-marker", {
        kind: "response",
        method: "GET",
        statusCode: 200,
    }),
]) {
    test(
        "JSON errors do not serialize native diagnostics: " +
            error.name +
            " " +
            (error instanceof BitbucketApiError ? error.kind : ""),
        async (t) => {
            const f = fixture(t);
            f.git.remoteFetchUrl = () => {
                throw error;
            };
            await f.run(["get-pr-url", "feature/test", "develop", "--json"]);
            const result = f.read();
            assert.equal(result.data, null);
            assert.equal(result.ok, false);
            assert.equal(f.request.mock.callCount(), 0);
        },
    );
}

for (const args of [
    ["--json", "unknown-command"],
    ["--json", "get-pr-urls", "feature/test"],
    ["--json", "get-pr-url", "develop", "--repository"],
    ["get-pr-url", "--json", "develop", "--unknown"],
    ["get-pr-url", "develop", "--unknown", "--json"],
]) {
    test("Commander syntax errors emit one JSON document: " + args.join(" "), async (t) => {
        const f = fixture(t);
        Object.defineProperty(f.context, "config", {
            get() {
                throw new Error("Configuration must remain lazy.");
            },
        });
        await f.run(args);
        assert.equal(f.read().error?.code, "CLI_ARGUMENT_ERROR");
        assert.equal(f.request.mock.callCount(), 0);
    });
}

for (const args of [
    ["config", "init"],
    ["token", "set"],
    ["git", "status"],
]) {
    test("unsupported JSON commands fail before side effects: " + args.join(" "), async (t) => {
        const f = fixture(t);
        Object.defineProperty(f.context, "gitClient", {
            get() {
                throw new Error("Git must remain lazy.");
            },
        });
        await f.run(["--json", ...args]);
        assert.equal(f.read().error?.code, "JSON_OUTPUT_UNSUPPORTED");
    });
}

test("JSON errors restore the global working directory", async (t) => {
    const f = fixture(t);
    const directory = mkdtempSync(join(tmpdir(), "bb-json-cli-"));
    t.after(() => {
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        rmSync(directory, { recursive: true, force: true });
    });
    const original = process.cwd();
    await f.run(["--json", "-C", directory, "get-pr-url", "develop", "develop"]);
    assert.equal(resolve(process.cwd()), resolve(original));
    assert.equal(f.read().error?.code, "APPLICATION_ERROR");
});

test("Git arguments named --json remain pass-through arguments", async (t) => {
    const f = fixture(t);
    const run = t.mock.fn(() => 0);
    f.git.run = run;
    await f.run(["git", "status", "--json"]);
    assert.deepEqual(run.mock.calls[0].arguments, [["status", "--json"]]);
    assert.equal(f.output.mock.callCount(), 0);
});
