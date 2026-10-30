export function resolvePullRequestReviewers(
    reviewers: string[],
    noReviewers: boolean,
    defaultReviewers: string[],
): string[] {
    if (noReviewers && reviewers.length > 0) {
        throw new Error("--reviewer and --no-reviewers cannot be used together.");
    }

    const selectedReviewers = noReviewers
        ? []
        : reviewers.length > 0
          ? reviewers
          : defaultReviewers;

    return selectedReviewers.map((reviewer) => reviewer.trim()).filter(Boolean);
}
