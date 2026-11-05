export type MergeCheck = {
    code: "PR_OPEN" | "PR_VERSION" | "REVIEWERS" | "TASKS" | "SERVER_MERGE";
    status: "PASS" | "WARN" | "FAIL" | "SKIP";
    message: string;
};
