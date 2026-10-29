import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import type { BbConfig } from "../src/config/config.ts";
import { GitClient } from "../src/git/git-client.ts";
import { GitCommandError } from "../src/git/git-command-error.ts";
import { resolveRepositoryContext } from "../src/repository/repository-context.ts";

function createFixture(t: TestContext) {
    const config: BbConfig = {
        bitbucket: { url: "https://bitbucket.example", projectKey: " PROJECT ", defaultReviewers: [] },
        git: { remote: "origin" },
    };
    const git = new GitClient("origin", () => { throw new Error("Repository discovery must not request a token."); });
    const currentRepository = t.mock.method(git, "currentRepository", () => "payments");
    return { config, git, currentRepository };
}

test("repository context uses the configured project and current Git repository", (t) => {
    const { config, git, currentRepository } = createFixture(t);
    assert.deepEqual(resolveRepositoryContext(config, git), { projectKey: "PROJECT", repository: "payments" });
    assert.equal(currentRepository.mock.callCount(), 1);
});

test("explicit project and repository overrides take priority without querying Git", (t) => {
    const { config, git, currentRepository } = createFixture(t);
    assert.deepEqual(resolveRepositoryContext(config, git, { projectKey: " OTHER ", repository: " explicit-repo " }), {
        projectKey: "OTHER", repository: "explicit-repo",
    });
    assert.equal(currentRepository.mock.callCount(), 0);
});

test("blank overrides fall back to configured and discovered values", (t) => {
    const { config, git } = createFixture(t);
    assert.deepEqual(resolveRepositoryContext(config, git, { projectKey: " ", repository: " " }), {
        projectKey: "PROJECT", repository: "payments",
    });
});

test("a missing project fails before querying Git", (t) => {
    const { config, git, currentRepository } = createFixture(t);
    config.bitbucket.projectKey = " ";
    assert.throws(() => resolveRepositoryContext(config, git), /Unable to determine the Bitbucket project/);
    assert.equal(currentRepository.mock.callCount(), 0);
});

test("a missing repository reports an explicit error", (t) => {
    const { config, git, currentRepository } = createFixture(t);
    currentRepository.mock.mockImplementation(() => "");
    assert.throws(() => resolveRepositoryContext(config, git), /Unable to determine the current repository/);
});

test("repository discovery preserves structured Git errors", (t) => {
    const { config, git, currentRepository } = createFixture(t);
    const failure = new GitCommandError("Not a Git repository.", { exitCode: 128, args: ["rev-parse", "--show-toplevel"] });
    currentRepository.mock.mockImplementation(() => { throw failure; });
    assert.throws(() => resolveRepositoryContext(config, git), (error: unknown) => error === failure);
});
