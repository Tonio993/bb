import type { Command } from "commander";

import { mergeOpenPullRequest } from "../application/merge-pull-request.ts";
import type { CommandContext } from "../cli/command-context.ts";
import { resolvePullRequestBranches } from "../pullrequest/branches.ts";
import { resolveRepositoryContext } from "../repository/repository-context.ts";

type MergePrOptions = {
    sourceBranch?: string;
    targetBranch?: string;
    projectKey?: string;
    messagePrefix?: string;
    completeTasks?: boolean;
};

export function registerMergePrCommand(
    program: Command,
    context: CommandContext,
): void {
    program
        .command("merge-pr")
        .description("Merge an open Pull Request through the Bitbucket REST API.")
        .argument("[source]", "Source branch, or target branch when used alone")
        .argument("[target]", "Target branch")
        .option("--source-branch <branch>", "Source branch")
        .option("--target-branch <branch>", "Target branch")
        .option("--project-key <key>", "Override the configured Bitbucket project")
        .option("--message-prefix <prefix>", "Prepend a prefix to Bitbucket's suggested merge commit message")
        .option("--complete-tasks", "Complete all open Pull Request tasks before merging")
        .addHelpText("after", `
Examples:
  bb merge-pr develop
  bb merge-pr feature/my-change develop
  bb merge-pr --target-branch develop
  bb merge-pr --source-branch feature/my-change --target-branch develop
  bb merge-pr develop --project-key PROJECT
  bb merge-pr develop --message-prefix "[RELEASE] "
  bb merge-pr develop --complete-tasks
  bb -C C:\\repository merge-pr develop
`)
        .action(async (
            source: string | undefined,
            target: string | undefined,
            options: MergePrOptions,
        ) => {
            const branches = resolvePullRequestBranches(
                source,
                target,
                () => context.gitClient.currentBranch(),
                options,
            );
            const repository = resolveRepositoryContext(
                context.config,
                context.gitClient,
                { projectKey: options.projectKey },
            );
            const merged = await mergeOpenPullRequest(
                context.bitbucketClient,
                {
                    ...repository,
                    ...branches,
                    messagePrefix: options.messagePrefix,
                    completeTasks: options.completeTasks,
                },
            );
            const url = merged.links.self[0]?.href;

            if (!url) {
                throw new Error(
                    "Bitbucket did not provide the merged Pull Request URL.",
                );
            }

            console.log(url);
        });
}
