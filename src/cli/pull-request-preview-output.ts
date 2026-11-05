import type { CreatePullRequestOptions } from "../bitbucket/pull-request-types.ts";
import type { MergePullRequestPreview } from "../application/merge-pull-request-types.ts";
import { toPullRequestOutput } from "./pull-request-output.ts";
import type { MergePullRequestPreviewOutput } from "./json-output-types.ts";

export function toMergePreviewOutput(
    preview: MergePullRequestPreview,
): MergePullRequestPreviewOutput {
    return {
        dryRun: true,
        pullRequest: toPullRequestOutput(preview.pullRequest),
        plan: {
            tasksToComplete: preview.tasksToComplete.map(({ id, version, text }) => ({
                id,
                version,
                text: text ?? null,
            })),
            message: preview.message,
            messageMode: preview.messageMode,
            sourceDeletion:
                preview.sourceDeletion === null
                    ? null
                    : {
                          projectKey: preview.sourceDeletion.projectKey,
                          repository: preview.sourceDeletion.repository,
                          ref: preview.sourceDeletion.name,
                          expectedCommit: preview.sourceDeletion.endPoint,
                          afterConfirmedMerge: true,
                      },
        },
    };
}

export function formatCreatePreview(plan: CreatePullRequestOptions, remote: string): string {
    return [
        "Dry run: no Pull Request was created.",
        "Git fetch performed for remote: " + line(remote),
        "Repository: " + line(plan.projectKey) + "/" + line(plan.repository),
        "Source: " + line(plan.sourceBranch),
        "Target: " + line(plan.targetBranch),
        "Title: " + line(plan.title),
        "Reviewers: " + (plan.reviewers.map(line).join(", ") || "none"),
        "Description:",
        multiline(plan.description),
        "Creating the Pull Request may still fail because of server permissions or policy.",
    ].join("\n");
}

export function formatMergePreview(preview: MergePullRequestPreview): string {
    const result = toMergePreviewOutput(preview);
    return [
        "Dry run: no tasks were completed, no merge or branch deletion was performed.",
        "Pull Request: #" +
            result.pullRequest.id +
            (result.pullRequest.url ? " " + result.pullRequest.url : ""),
        "Source: " +
            line(
                result.pullRequest.source.projectKey +
                    "/" +
                    result.pullRequest.source.repository +
                    " " +
                    result.pullRequest.source.branch,
            ),
        "Target: " +
            line(
                result.pullRequest.target.projectKey +
                    "/" +
                    result.pullRequest.target.repository +
                    " " +
                    result.pullRequest.target.branch,
            ),
        "Tasks to complete: " + result.plan.tasksToComplete.length,
        ...result.plan.tasksToComplete.map(
            (task) => "  #" + task.id + (task.text ? " " + line(task.text) : ""),
        ),
        "Message mode: " + result.plan.messageMode,
        "Suggested merge message:",
        multiline(result.plan.message),
        result.plan.sourceDeletion
            ? "Delete source after confirmed merge: " +
              line(
                  result.plan.sourceDeletion.projectKey +
                      "/" +
                      result.plan.sourceDeletion.repository +
                      " " +
                      result.plan.sourceDeletion.ref,
              ) +
              " at " +
              line(result.plan.sourceDeletion.expectedCommit)
            : "Source deletion: not requested.",
        "Read-only snapshot; task state, PR version, and the final message may change. Server merge checks still apply; use 'bb pr checks' to inspect current blockers.",
    ].join("\n");
}

function line(value: string): string {
    return multiline(value).replace(/\s+/g, " ").trim();
}
function multiline(value: string): string {
    return value.replace(/[\p{Cc}\p{Cf}]/gu, (character) => (character === "\n" ? "\n" : " "));
}
