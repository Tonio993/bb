import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import {
    BitbucketClient,
    type FetchImplementation,
} from "../../../src/bitbucket/bitbucket-client.ts";
import { runCli } from "../../../src/cli/cli.ts";
import type { CommandContext } from "../../../src/cli/command-context.ts";
import { createGitStub } from "../../helpers/git-stub.ts";

function fixture(t: TestContext) {
    const previous = process.exitCode;
    t.after(() => {
        process.exitCode = previous;
    });
    const repository = { name: "Payments", slug: "payments", project: { key: "PROJECT" } };
    const pr = {
        id: 42,
        version: 7,
        state: "OPEN",
        title: "Improve payments",
        author: {
            user: {
                name: "jane",
                slug: "jane",
                displayName: "Jane",
                emailAddress: "private-marker",
            },
        },
        reviewers: [
            {
                status: "APPROVED",
                user: { name: "john", displayName: "John", emailAddress: "private-marker" },
            },
        ],
        fromRef: {
            id: "refs/heads/feature/test",
            displayId: "feature/test",
            repository: { name: "Fork", slug: "fork", project: { key: "FORK" } },
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
    const tasks = [
        {
            id: 101,
            version: 0,
            state: "OPEN",
            severity: "BLOCKER",
            text: "Fix validation",
            extra: "private-marker",
        },
        { id: 102, version: 1, state: "RESOLVED", severity: "BLOCKER", text: "Done" },
        { id: 103, version: 0, state: "OPEN", severity: "NORMAL", text: "Comment" },
    ];
    const page = (values: unknown[]) => ({
        values,
        size: values.length,
        start: 0,
        limit: 100,
        isLastPage: true,
    });
    const responses: { body: unknown; status?: number }[] = [];
    const requests: { path: string; method: string }[] = [];
    const request = t.mock.fn<FetchImplementation>(async (input, init) => {
        const url = new URL(String(input));
        requests.push({ path: url.pathname + url.search, method: init?.method ?? "GET" });
        const next = responses.shift();
        assert.ok(next, "Unexpected REST request.");
        return Response.json(next.body, { status: next.status ?? 200 });
    });
    const remote = t.mock.fn(() => "https://bitbucket.example/context/scm/PROJECT/payments.git");
    const context: CommandContext = {
        config: {
            bitbucket: {
                url: "https://bitbucket.example/context",
                defaultReviewers: [],
                sshHostnames: [],
            },
            git: { remote: "upstream" },
        },
        gitClient: createGitStub({ remoteFetchUrl: remote }),
        bitbucketClient: new BitbucketClient(
            "https://bitbucket.example/context",
            () => "test-token",
            { fetch: request },
        ),
        get doctor(): never {
            throw new Error("Doctor must remain lazy.");
        },
        get tokenStore(): never {
            throw new Error("Token store is injected.");
        },
        get configStore(): never {
            throw new Error("Configuration is injected.");
        },
    };
    const output = t.mock.method(console, "log", () => {});
    const stderr: string[] = [];
    t.mock.method(process.stderr, "write", (value: string | Uint8Array) => {
        stderr.push(value.toString());
        return true;
    });
    return {
        pr,
        tasks,
        page,
        context,
        responses,
        requests,
        remote,
        output,
        stderr,
        run: (args: string[]) => runCli(args, context),
        json: () => {
            assert.equal(output.mock.callCount(), 1);
            assert.equal(stderr.join(""), "");
            return JSON.parse(String(output.mock.calls[0].arguments[0]));
        },
    };
}
const root = "/context/rest/api/latest/projects/PROJECT/repos/payments/pull-requests";

for (const state of ["MERGED", "DECLINED"]) {
    test("pr list requests historical state " + state, async (t) => {
        const f = fixture(t);
        f.responses.push({ body: f.page([{ ...f.pr, state }]) }, { body: f.page([]) });
        await f.run(["pr", "--json", "list", "--state", state]);
        const result = f.json();
        assert.equal(result.data.pullRequests[0].state, state);
        assert.deepEqual(result.data.pullRequests[0].openTasks, []);
        assert.equal(f.requests[0].path, root + "?state=" + state + "&start=0&limit=100");
    });
}

test("an author mismatch produces an empty list without loading tasks", async (t) => {
    const f = fixture(t);
    f.responses.push({ body: f.page([f.pr]) });
    await f.run(["pr", "list", "--author", "Jane Smith", "--json"]);
    assert.deepEqual(f.json().data, { pullRequests: [] });
    assert.equal(f.requests.length, 1);
});

test("text consultation removes terminal controls from title and task content", async (t) => {
    const f = fixture(t);
    f.responses.push(
        { body: { ...f.pr, title: "Title\nInjected\u001b[31m" } },
        { body: f.page([{ ...f.tasks[0], text: "Task\r\nInjected\u001b[0m" }]) },
    );
    await f.run(["pr", "show", "42"]);
    const output = String(f.output.mock.calls[0].arguments[0]);
    assert.doesNotMatch(output, /\u001b|\r/);
    assert.ok(output.includes("Title Injected"));
    assert.ok(output.includes("Task Injected"));
});

test("pr list renders title, author, branches, reviewer and open blocker text", async (t) => {
    const f = fixture(t);
    f.responses.push({ body: f.page([f.pr]) }, { body: f.page(f.tasks) });
    await f.run(["pr", "list"]);
    const text = String(f.output.mock.calls[0].arguments[0]);
    for (const expected of [
        "Improve payments",
        "Jane (jane)",
        "FORK/fork feature/test",
        "PROJECT/payments develop",
        "John (john): APPROVED",
        "Open tasks: 1",
        "#101 Fix validation",
    ])
        assert.ok(text.includes(expected), text);
    assert.doesNotMatch(text, /private-marker|#102|#103/);
    assert.equal(f.remote.mock.callCount(), 1);
    assert.deepEqual(f.requests, [
        { path: root + "?state=OPEN&start=0&limit=100", method: "GET" },
        { path: root + "/42/blocker-comments?start=0&limit=100", method: "GET" },
    ]);
});

test("pr list follows PR and task pagination and filters authors before loading tasks", async (t) => {
    const f = fixture(t);
    f.responses.push(
        {
            body: {
                ...f.page([{ ...f.pr, id: 41, author: { user: { name: "other" } } }]),
                isLastPage: false,
                nextPageStart: 37,
            },
        },
        { body: f.page([f.pr]) },
        { body: { ...f.page([f.tasks[0]]), isLastPage: false, nextPageStart: 23 } },
        { body: f.page([f.tasks[1]]) },
    );
    await f.run(["--json", "pr", "list", "--author", " JANE ", "--state", "ALL"]);
    const result = f.json();
    assert.equal(result.command, "pr list");
    assert.equal(result.data.pullRequests.length, 1);
    assert.equal(result.data.pullRequests[0].author.name, "jane");
    assert.deepEqual(result.data.pullRequests[0].openTasks, [{ id: 101, text: "Fix validation" }]);
    assert.doesNotMatch(JSON.stringify(result), /private-marker|emailAddress/);
    assert.ok(f.requests[1].path.endsWith("state=ALL&start=37&limit=100"));
    assert.ok(f.requests[3].path.endsWith("start=23&limit=100"));
});

for (const json of [false, true]) {
    test("pr list returns an empty result without task reads, json=" + json, async (t) => {
        const f = fixture(t);
        f.responses.push({ body: f.page([]) });
        await f.run(["pr", "list", ...(json ? ["--json"] : [])]);
        if (json) assert.deepEqual(f.json().data, { pullRequests: [] });
        else assert.equal(f.output.mock.calls[0].arguments[0], "No Pull Requests found.");
        assert.equal(f.requests.length, 1);
    });
}

for (const selection of [
    "42",
    "https://bitbucket.example/context/projects/PROJECT/repos/payments/pull-requests/42/overview?x=1#comment-101",
]) {
    test("pr show works without initializing Git for selection " + selection, async (t) => {
        const f = fixture(t);
        f.responses.push({ body: f.pr }, { body: f.page(f.tasks) });
        Object.defineProperty(f.context, "gitClient", {
            get() {
                throw new Error("Git must remain lazy.");
            },
        });
        await f.run([
            "pr",
            "show",
            selection,
            "--project-key",
            "PROJECT",
            "--repository",
            "payments",
            "--json",
        ]);
        const result = f.json();
        assert.equal(result.command, "pr show");
        assert.equal(result.data.pullRequest.id, 42);
        assert.equal(result.data.pullRequest.author.name, "jane");
        assert.equal(result.data.pullRequest.reviewers[0].user.name, "john");
        assert.equal(f.requests[0].path, root + "/42");
    });
}
test("pr show URL supplies repository and project without overrides or Git", async (t) => {
    const f = fixture(t);
    f.responses.push({ body: f.pr }, { body: f.page([]) });
    Object.defineProperty(f.context, "gitClient", {
        get() {
            throw new Error("Git must remain lazy.");
        },
    });
    await f.run(["pr", "show", f.pr.links.self[0].href]);
    assert.match(String(f.output.mock.calls[0].arguments[0]), /#42 OPEN/);
});

for (const args of [
    ["pr", "show", "0"],
    ["pr", "show", "https://other.example/context/projects/P/repos/r/pull-requests/42"],
    ["pr", "show", "https://bitbucket.example/other/projects/P/repos/r/pull-requests/42"],
    [
        "pr",
        "show",
        "https://bitbucket.example/context/projects/P/repos/r/pull-requests/42",
        "--project-key",
        "OTHER",
    ],
    ["pr", "list", "--author", " "],
]) {
    test("invalid PR inputs fail before HTTP: " + args.join(" "), async (t) => {
        const f = fixture(t);
        await f.run(["--json", ...args]);
        assert.equal(f.json().ok, false);
        assert.equal(f.requests.length, 0);
        assert.equal(f.remote.mock.callCount(), 0);
    });
}
for (const status of [403, 404]) {
    test("pr show preserves structured access errors without task reads: " + status, async (t) => {
        const f = fixture(t);
        f.responses.push({ body: { errors: [{ message: "private-marker" }] }, status });
        await f.run(["--json", "pr", "show", "42"]);
        const result = f.json();
        assert.equal(result.error.httpStatus, status);
        assert.equal(f.requests.length, 1);
        assert.doesNotMatch(JSON.stringify(result), /private-marker/);
    });
}
test("missing consultation metadata is an invalid response rather than an empty list", async (t) => {
    const f = fixture(t);
    f.responses.push({ body: f.page([{ ...f.pr, title: undefined }]) });
    await f.run(["--json", "pr", "list"]);
    assert.equal(f.json().error.code, "INVALID_RESPONSE");
    assert.equal(f.requests.length, 1);
});
test("pr show rejects a different returned PR before task reads", async (t) => {
    const f = fixture(t);
    f.responses.push({ body: { ...f.pr, id: 43 } });
    await f.run(["--json", "pr", "show", "42"]);
    assert.equal(f.json().ok, false);
    assert.equal(f.requests.length, 1);
});
test("broken task pagination fails atomically without partial output", async (t) => {
    const f = fixture(t);
    f.responses.push(
        { body: f.pr },
        { body: { ...f.page(f.tasks), isLastPage: false, nextPageStart: 0 } },
    );
    await f.run(["--json", "pr", "show", "42"]);
    assert.equal(f.json().ok, false);
    assert.equal(f.requests.length, 2);
});
