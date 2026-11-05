import type { Command } from "commander";

import {
    mergeOpenPullRequest,
    previewOpenPullRequest,
} from "../../application/merge-pull-request.ts";
import { formatMergePreview, toMergePreviewOutput } from "../pull-request-preview-output.ts";
import { resolvePullRequestBranches } from "../../pull-request/branches.ts";
import { resolveRepositoryContext } from "../../repository/repository-context.ts";
import type { CommandContext } from "../command-context.ts";
import { usesJsonOutput, writeJsonResult } from "../json-output.ts";
import { toJsonError } from "../json-errors.ts";
import { toPullRequestOutput } from "../pull-request-output.ts";

type MergePrOptions = {
    sourceBranch?: string;
    targetBranch?: string;
    projectKey?: string;
    repository?: string;
    messagePrefix?: string;
    completeTasks?: boolean;
    deleteSource?: boolean;
    dryRun?: boolean;
};

export function registerMergePrCommand(program: Command, context: CommandContext): void {
    program
        .command("merge-pr")
        .description("Merge an open Pull Request through the Bitbucket REST API.")
        .option("--json", "Output a versioned JSON result for scripts and CI")
        .option(
            "--dry-run",
            "Preview the merge plan using GET requests only; do not modify tasks, merge, or delete branches",
        )
        .argument("[source]", "Source branch, or target branch when used alone")
        .argument("[target]", "Target branch")
        .option("--source-branch <branch>", "Source branch")
        .option("--target-branch <branch>", "Target branch")
        .option("--project-key <key>", "Override the detected or configured Bitbucket project")
        .option("--repository <slug>", "Override the repository detected from the Git remote")
        .option(
            "--message-prefix <prefix>",
            "Prepend a prefix to Bitbucket's suggested merge commit message",
        )
        .option("--complete-tasks", "Complete all open Pull Request tasks before merging")
        .option("--delete-source", "Delete the remote source branch after a confirmed merge")
        .addHelpText(
            "after",
            `
Examples:
  bb merge-pr develop
  bb merge-pr feature/my-change develop
  bb merge-pr --target-branch develop
  bb merge-pr --source-branch feature/my-change --target-branch develop
  bb merge-pr develop --project-key PROJECT
  bb merge-pr feature/my-change develop --project-key PROJECT --repository payments
  bb merge-pr develop --message-prefix "[RELEASE] "
  bb merge-pr develop --complete-tasks
  bb merge-pr develop --delete-source
  bb -C C:\\repository merge-pr develop
`,
        )
        .action(
            async (
                source: string | undefined,
                target: string | undefined,
                options: MergePrOptions,
                command: Command,
            ) => {
                const branches = resolvePullRequestBranches(
                    source,
                    target,
                    () => context.gitClient.currentBranch(),
                    options,
                );
                const repository = resolveRepositoryContext(
                    context.config,
                    () => context.gitClient,
                    {
                        projectKey: options.projectKey,
                        repository: options.repository,
                    },
                );
                const mergeOptions = {
                    ...repository,
                    ...branches,
                    messagePrefix: options.messagePrefix,
                    completeTasks: options.completeTasks,
                    deleteSource: options.deleteSource,
                };
                if (options.dryRun) {
                    const preview = await previewOpenPullRequest(
                        context.bitbucketClient,
                        mergeOptions,
                    );
                    if (usesJsonOutput(command))
                        writeJsonResult("merge-pr", toMergePreviewOutput(preview));
                    else console.log(formatMergePreview(preview));
                    return;
                }
                const result = await mergeOpenPullRequest(context.bitbucketClient, mergeOptions);
                const url = result.pullRequest.links.self[0]?.href;
                if (!url && result.sourceDeletion !== "failed") {
                    throw new Error("Bitbucket did not provide the merged Pull Request URL.");
                }

                if (usesJsonOutput(command)) {
                    writeJsonResult(
                        "merge-pr",
                        {
                            pullRequest: toPullRequestOutput(result.pullRequest),
                            sourceDeletion: result.sourceDeletion,
                        },
                        result.sourceDeletion === "failed"
                            ? {
                                  code: "SOURCE_DELETION_FAILED",
                                  message:
                                      "The Pull Request was merged, but source branch deletion failed or could not be confirmed. Check the branch state before retrying deletion.",
                                  cause: toJsonError(result.error),
                              }
                            : null,
                    );
                    return;
                }

                if (result.sourceDeletion === "failed") {
                    if (url) console.log(url);
                    console.error(
                        `Pull Request #${result.pullRequest.id} was merged, but source branch deletion failed or could not be confirmed: ${result.error.message} Check the branch state before retrying deletion.`,
                    );
                    process.exitCode = 1;
                    return;
                }

                console.log(url);
            },
        );
}
