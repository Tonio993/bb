import type { GitOperations } from "../../src/git/git-types.ts";

export function createGitStub(overrides: Partial<GitOperations> = {}): GitOperations {
    const unexpected = (): never => {
        throw new Error("Unexpected Git operation in this test.");
    };
    return {
        run: unexpected,
        currentBranch: unexpected,
        currentRepository: unexpected,
        fetch: unexpected,
        assertRemoteBranchExists: unexpected,
        commitsBetween: unexpected,
        ...overrides,
    };
}
