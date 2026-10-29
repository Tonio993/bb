export type PullRequestBranches = {
    sourceBranch: string;
    targetBranch: string;
};


type CurrentBranchProvider =
    () => string;


export function resolvePullRequestBranches(
    sourceBranch: string | undefined,
    targetBranch: string | undefined,
    currentBranchProvider: CurrentBranchProvider,
): PullRequestBranches {
    if (!sourceBranch && !targetBranch) {
        throw new Error(
            "Target branch is required.",
        );
    }

    if (!targetBranch) {
        targetBranch =
            sourceBranch;

        sourceBranch =
            currentBranchProvider();
    } else if (!sourceBranch) {
        sourceBranch =
            currentBranchProvider();
    }

    if (!sourceBranch || !targetBranch) {
        throw new Error(
            "Unable to resolve Pull Request branches.",
        );
    }

    if (sourceBranch === targetBranch) {
        throw new Error(
            "Source and target branches cannot be the same.",
        );
    }

    return {
        sourceBranch,
        targetBranch,
    };
}
