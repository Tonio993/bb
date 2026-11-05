import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

export function createGitFixture(t: TestContext) {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "bb-native-git-")));
    const originalDirectory = process.cwd();
    t.after(() => {
        process.chdir(originalDirectory);
        assert.equal(dirname(directory), realpathSync(tmpdir()));
        rmSync(directory, { recursive: true, force: true });
    });
    const repository = join(directory, "renamed checkout");
    const nested = join(repository, "nested directory");
    const outside = join(directory, "not a repository");
    const worktree = join(directory, "another checkout");
    const emptyHooks = join(directory, "empty hooks and template");
    for (const path of [nested, outside, emptyHooks]) mkdirSync(path, { recursive: true });
    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(environment)) {
        if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
    }
    Object.assign(environment, {
        BB_TOKEN: "",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(directory, "empty git config"),
        GIT_TEMPLATE_DIR: emptyHooks,
        GIT_CEILING_DIRECTORIES: directory,
        GIT_CONFIG_COUNT: "3",
        GIT_CONFIG_KEY_0: "safe.directory",
        GIT_CONFIG_VALUE_0: repository,
        GIT_CONFIG_KEY_1: "safe.directory",
        GIT_CONFIG_VALUE_1: worktree,
        GIT_CONFIG_KEY_2: "core.hooksPath",
        GIT_CONFIG_VALUE_2: emptyHooks,
    });
    const git = (args: string[], cwd = repository) => {
        const result = spawnSync("git", args, {
            cwd,
            env: environment,
            encoding: "utf8",
            windowsHide: true,
            timeout: 10000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    git(["init", "--quiet", "--initial-branch=feature/test"]);
    return { directory, repository, nested, outside, worktree, environment, git };
}
