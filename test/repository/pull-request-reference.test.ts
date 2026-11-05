import assert from "node:assert/strict";
import { test } from "node:test";
import {
    parsePullRequestReference,
    resolvePullRequestIdentity,
} from "../../src/repository/pull-request-reference.ts";

const config = {
    bitbucket: { url: "https://bitbucket.example/context", projectKey: "STALE" },
    git: { remote: "upstream" },
};
const noGit = (): never => {
    throw new Error("Git must remain lazy.");
};

for (const value of ["42", " 0042 "]) {
    test("numeric PR selection uses explicit identity without Git: " + value, () => {
        assert.deepEqual(
            resolvePullRequestIdentity(config, noGit, parsePullRequestReference(value), {
                projectKey: " PROJECT ",
                repository: " payments ",
            }),
            { projectKey: "PROJECT", repository: "payments", pullRequestId: 42 },
        );
    });
}
test("numeric PR selection can discover the repository and project", () => {
    let calls = 0;
    const identity = resolvePullRequestIdentity(
        config,
        () => ({
            remoteFetchUrl: (remote?: string) => {
                calls++;
                assert.equal(remote, "upstream");
                return "https://bitbucket.example/context/scm/PROJECT/payments.git";
            },
        }),
        parsePullRequestReference("42"),
    );
    assert.equal(calls, 1);
    assert.deepEqual(identity, {
        projectKey: "PROJECT",
        repository: "payments",
        pullRequestId: 42,
    });
});

for (const suffix of [
    "",
    "/",
    "/overview",
    "/diff?token=private-marker#comment-1",
    "/commits/",
    "/activities",
]) {
    test("web PR URL supplies identity without Git: " + suffix, () => {
        const ref = parsePullRequestReference(
            "https://BITBUCKET.example:443/context/projects/PROJECT/repos/payments/pull-requests/42" +
                suffix,
        );
        assert.deepEqual(resolvePullRequestIdentity(config, noGit, ref), {
            projectKey: "PROJECT",
            repository: "payments",
            pullRequestId: 42,
        });
    });
}
test("personal repository URLs map users to personal project keys", () => {
    const ref = parsePullRequestReference(
        "https://bitbucket.example/context/users/jane.doe/repos/payments/pull-requests/42",
    );
    assert.equal(resolvePullRequestIdentity(config, noGit, ref).projectKey, "~jane.doe");
});
test("web repository names ending in .git retain their actual slug", () => {
    const ref = parsePullRequestReference(
        "https://bitbucket.example/context/projects/PROJECT/repos/payments.git/pull-requests/42",
    );
    assert.equal(resolvePullRequestIdentity(config, noGit, ref).repository, "payments.git");
});

for (const value of [
    "",
    "0",
    "-1",
    "1.2",
    "9007199254740992",
    "42suffix",
    "file:///projects/P/repos/r/pull-requests/42",
    "https://private-marker:private-marker@bitbucket.example/context/projects/P/repos/r/pull-requests/42",
    "https://bitbucket.example/context/projects/P/repos/r/pull-requests/0",
    "https://bitbucket.example/context/projects/P/repos/r/pull-requests/9007199254740992",
    "https://bitbucket.example/context/projects/P/repos/r/pull-requests/42/extra",
    "https://bitbucket.example/context/../context/projects/P/repos/r/pull-requests/42",
    "https://bitbucket.example/context/projects/P/repos/%2Fprivate-marker/pull-requests/42",
    "https://bitbucket.example/context/projects/P/repos/r//pull-requests/42",
    "https://bitbucket.example/context/projects/P/repos/%ZZ/pull-requests/42",
]) {
    test("invalid PR references fail without disclosing input: " + value, () => {
        assert.throws(
            () => parsePullRequestReference(value),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /Invalid Pull Request reference/);
                assert.doesNotMatch(error.message + error.stack, /private-marker/);
                return true;
            },
        );
    });
}
for (const base of [
    "https://other.example/context",
    "http://bitbucket.example/context",
    "https://bitbucket.example:8443/context",
    "https://bitbucket.example/other",
    "https://bitbucket.example/context/nested",
]) {
    test("PR URLs must match the configured server and context: " + base, () => {
        const ref = parsePullRequestReference(
            base + "/projects/PROJECT/repos/payments/pull-requests/42",
        );
        assert.throws(() => resolvePullRequestIdentity(config, noGit, ref), /does not match/);
    });
}
test("explicit overrides must agree with the web PR URL", () => {
    const ref = parsePullRequestReference(
        "https://bitbucket.example/context/projects/PROJECT/repos/payments/pull-requests/42",
    );
    assert.doesNotThrow(() =>
        resolvePullRequestIdentity(config, noGit, ref, {
            projectKey: "project",
            repository: "PAYMENTS",
        }),
    );
    assert.throws(
        () => resolvePullRequestIdentity(config, noGit, ref, { projectKey: "OTHER" }),
        /conflict/,
    );
    assert.throws(
        () => resolvePullRequestIdentity(config, noGit, ref, { repository: "other" }),
        /conflict/,
    );
});
