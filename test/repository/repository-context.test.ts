import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { GitCommandError } from "../../src/git/git-command-error.ts";
import { resolveRepositoryContext } from "../../src/repository/repository-context.ts";
import type { RepositoryContextConfig } from "../../src/repository/repository-types.ts";

function fixture(t: TestContext) {
    const config: RepositoryContextConfig = {
        bitbucket: { url: "https://bitbucket.example/bitbucket", projectKey: " CONFIGURED " },
        git: { remote: "upstream" },
    };
    const remoteFetchUrl = t.mock.fn(
        (_remote?: string) => "https://bitbucket.example/bitbucket/scm/REMOTE/payments.git",
    );
    const currentRepository = t.mock.fn(() => "renamed checkout");
    return {
        config,
        remoteFetchUrl,
        currentRepository,
        git: { remoteFetchUrl, currentRepository },
    };
}

test("remote identity overrides global defaults and ignores the checkout directory name", (t) => {
    const f = fixture(t);
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git),
        {
            projectKey: "REMOTE",
            repository: "payments",
        },
    );
    assert.equal(f.remoteFetchUrl.mock.callCount(), 1);
    assert.deepEqual(f.remoteFetchUrl.mock.calls[0].arguments, ["upstream"]);
    assert.equal(f.currentRepository.mock.callCount(), 0);
});

test("explicit project takes priority while the repository is inferred from the remote", (t) => {
    const f = fixture(t);
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git, { projectKey: " OTHER " }),
        {
            projectKey: "OTHER",
            repository: "payments",
        },
    );
    assert.equal(f.remoteFetchUrl.mock.callCount(), 1);
});

test("complete explicit overrides do not inspect Git or validate an unused server URL", (t) => {
    const f = fixture(t);
    f.config.bitbucket.url = "invalid";
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git, {
            projectKey: " OTHER ",
            repository: " explicit-repo ",
        }),
        { projectKey: "OTHER", repository: "explicit-repo" },
    );
    assert.equal(f.remoteFetchUrl.mock.callCount(), 0);
    assert.equal(f.currentRepository.mock.callCount(), 0);
});

test("a complete manual identity does not initialize the Git client", (t) => {
    const f = fixture(t);
    const getGit = () => {
        throw new Error("Git must remain lazy.");
    };
    assert.deepEqual(resolveRepositoryContext(f.config, getGit, { repository: "manual" }), {
        projectKey: "CONFIGURED",
        repository: "manual",
    });
});

test("trusted SSH hostnames can come from configuration", (t) => {
    const f = fixture(t);
    f.config.bitbucket.sshHostnames = ["SSH-GATEWAY"];
    f.remoteFetchUrl.mock.mockImplementation(() => "git@ssh-gateway:REMOTE/payments.git");
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git),
        { projectKey: "REMOTE", repository: "payments" },
    );
});

test("an explicit repository can use the configured project without querying Git", (t) => {
    const f = fixture(t);
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git, { repository: " manual " }),
        {
            projectKey: "CONFIGURED",
            repository: "manual",
        },
    );
    assert.equal(f.remoteFetchUrl.mock.callCount(), 0);
});

test("a remote supplies a missing configured project, including with a manual repository", (t) => {
    const f = fixture(t);
    delete f.config.bitbucket.projectKey;
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git),
        {
            projectKey: "REMOTE",
            repository: "payments",
        },
    );
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git, { repository: "manual" }),
        {
            projectKey: "REMOTE",
            repository: "manual",
        },
    );
});

test("blank overrides are ignored and do not suppress discovery", (t) => {
    const f = fixture(t);
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git, { projectKey: " ", repository: " " }),
        { projectKey: "REMOTE", repository: "payments" },
    );
});

for (const value of [
    "",
    "invalid",
    "https://private-user:private-token@bitbucket.example/bitbucket",
    "https://bitbucket.example/%ZZ",
]) {
    test("invalid server configuration prevents Git lookup: " + value, (t) => {
        const f = fixture(t);
        f.config.bitbucket.url = value;
        assert.throws(
            () => resolveRepositoryContext(f.config, () => f.git),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.doesNotMatch(error.message + error.stack, /private-user|private-token/);
                return true;
            },
        );
        assert.equal(f.remoteFetchUrl.mock.callCount(), 0);
    });
}

test("Git discovery errors are preserved without a directory fallback", (t) => {
    const f = fixture(t);
    const error = new GitCommandError("Unable to read remote URL.", {
        exitCode: 128,
        args: ["remote", "get-url", "--", "upstream"],
    });
    f.remoteFetchUrl.mock.mockImplementation(() => {
        throw error;
    });
    assert.throws(
        () => resolveRepositoryContext(f.config, () => f.git),
        (actual: unknown) => actual === error,
    );
    assert.equal(f.currentRepository.mock.callCount(), 0);
});

test("unrecognized remotes do not silently use the global project or directory name", (t) => {
    const f = fixture(t);
    f.remoteFetchUrl.mock.mockImplementation(
        () => "https://private-user:private-token@other.example/invalid",
    );
    assert.throws(
        () => resolveRepositoryContext(f.config, () => f.git),
        (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.doesNotMatch(error.message + error.stack, /private-user|private-token/);
            return true;
        },
    );
    assert.equal(f.currentRepository.mock.callCount(), 0);
});

for (const remote of [
    "https://other.example/bitbucket/scm/REMOTE/payments.git",
    "http://bitbucket.example/bitbucket/scm/REMOTE/payments.git",
    "https://bitbucket.example:8443/bitbucket/scm/REMOTE/payments.git",
    "https://bitbucket.example/bitbucket-other/scm/REMOTE/payments.git",
    "https://bitbucket.example/bitbucket/nested/scm/REMOTE/payments.git",
]) {
    test("HTTP discovery rejects a different server or context: " + remote, (t) => {
        const f = fixture(t);
        f.remoteFetchUrl.mock.mockImplementation(() => remote);
        assert.throws(
            () =>
                resolveRepositoryContext(f.config, () => f.git, {
                    sshHostnames: ["other.example"],
                }),
            /HTTP remote does not match/,
        );
    });
}

test("HTTP matching normalizes host case, default ports and encoded context segments", (t) => {
    const f = fixture(t);
    f.config.bitbucket.url = "HTTPS://BITBUCKET.example:443/%62itbucket/";
    assert.equal(resolveRepositoryContext(f.config, () => f.git).repository, "payments");
});

for (const remote of [
    "ssh://git@bitbucket.example:7999/upstream/REMOTE/payments.git",
    "git@bitbucket.example:REMOTE/payments.git",
]) {
    test(
        "SSH matches the HTTP hostname without comparing transport ports or paths: " + remote,
        (t) => {
            const f = fixture(t);
            f.remoteFetchUrl.mock.mockImplementation(() => remote);
            assert.deepEqual(
                resolveRepositoryContext(f.config, () => f.git),
                {
                    projectKey: "REMOTE",
                    repository: "payments",
                },
            );
        },
    );
}

test("SSH aliases require an explicit trusted hostname association", (t) => {
    const f = fixture(t);
    f.remoteFetchUrl.mock.mockImplementation(() => "git@ssh-gateway:REMOTE/payments.git");
    assert.throws(
        () => resolveRepositoryContext(f.config, () => f.git),
        /SSH remote does not match/,
    );
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git, { sshHostnames: [" SSH-GATEWAY "] }),
        { projectKey: "REMOTE", repository: "payments" },
    );
});

test("IPv6 SSH host associations are canonicalized", (t) => {
    const f = fixture(t);
    f.remoteFetchUrl.mock.mockImplementation(
        () => "ssh://git@[2001:db8::1]:7999/~jane/payments.git",
    );
    assert.deepEqual(
        resolveRepositoryContext(f.config, () => f.git, {
            sshHostnames: ["[2001:0DB8:0:0:0:0:0:1]"],
        }),
        { projectKey: "~jane", repository: "payments" },
    );
});

for (const hostname of [
    "",
    "*.example",
    "ssh://ssh-gateway",
    "ssh-gateway:7999",
    "ssh-gateway:",
    "ssh-gateway/path",
    "private-user:private-token@ssh-gateway",
]) {
    test("trusted SSH entries accept only hostnames: " + hostname, (t) => {
        const f = fixture(t);
        f.remoteFetchUrl.mock.mockImplementation(() => "git@ssh-gateway:REMOTE/payments.git");
        assert.throws(
            () => resolveRepositoryContext(f.config, () => f.git, { sshHostnames: [hostname] }),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /Invalid trusted SSH hostname/);
                assert.doesNotMatch(error.message + error.stack, /private-user|private-token/);
                return true;
            },
        );
    });
}
