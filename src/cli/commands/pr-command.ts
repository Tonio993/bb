import { Option } from "commander";
import type { Command } from "commander";
import type { CommandContext } from "../command-context.ts";
import type { PullRequestListState } from "../../bitbucket/pull-request-types.ts";
import { listPullRequestViews, showPullRequestView } from "../../application/read-pull-requests.ts";
import { resolveRepositoryContext } from "../../repository/repository-context.ts";
import {
    parsePullRequestReference,
    resolvePullRequestIdentity,
} from "../../repository/pull-request-reference.ts";
import { usesJsonOutput, writeJsonResult } from "../json-output.ts";
import { formatPullRequestView, toPullRequestViewOutput } from "../pull-request-view-output.ts";
import { checkPullRequest } from "../../application/check-pull-request.ts";
import {
    formatPullRequestChecks,
    toPullRequestChecksOutput,
} from "../pull-request-check-output.ts";

type RepositoryOptions = { projectKey?: string; repository?: string };
type ListOptions = RepositoryOptions & { state: PullRequestListState; author?: string };

export function registerPrCommand(program: Command, context: CommandContext): void {
    const pr = program
        .command("pr")
        .description("Inspect Pull Requests using read-only Bitbucket requests.")
        .option("--json", "Output a versioned JSON result for scripts and CI");
    pr.command("checks")
        .description(
            "Check local merge requirements and Bitbucket mergeability using read-only requests.",
        )
        .argument("<id-or-url>", "Pull Request ID or HTTP(S) URL")
        .option("--json", "Output a versioned JSON result for scripts and CI")
        .option("--project-key <key>", "Override the detected or configured Bitbucket project")
        .option("--repository <slug>", "Override the repository detected from the Git remote")
        .addHelpText(
            "after",
            "\nExit code: 0 when ready, 1 for blockers or failed checks. Open tasks are warnings unless server policy blocks them.\nNo writes, task completion, fetch, or merge are performed. A successful check does not guarantee a later merge.\n",
        )
        .action(async (value: string, options: RepositoryOptions, command: Command) => {
            const reference = parsePullRequestReference(value);
            const identity = resolvePullRequestIdentity(
                context.config,
                () => context.gitClient,
                reference,
                options,
            );
            const result = await checkPullRequest(context.bitbucketClient, identity);
            if (usesJsonOutput(command)) {
                writeJsonResult(
                    "pr checks",
                    toPullRequestChecksOutput(result),
                    result.readyForMerge
                        ? null
                        : {
                              code: "MERGE_CHECK_FAILED",
                              message: "One or more merge requirements are not satisfied.",
                          },
                );
            } else {
                console.log(formatPullRequestChecks(result));
                process.exitCode = result.readyForMerge ? 0 : 1;
            }
        });
    pr.command("list")
        .description(
            "List incoming Pull Requests in the selected repository, including reviewers and open tasks.",
        )
        .option("--json", "Output a versioned JSON result for scripts and CI")
        .option("--project-key <key>", "Override the detected or configured Bitbucket project")
        .option("--repository <slug>", "Override the repository detected from the Git remote")
        .option("--author <login>", "Filter by exact author login or slug, ignoring case")
        .addOption(
            new Option("--state <state>", "Filter Pull Requests by state")
                .choices(["OPEN", "MERGED", "DECLINED", "ALL"])
                .default("OPEN"),
        )
        .addHelpText(
            "after",
            "\nExamples:\n  bb pr list\n  bb pr list --author jsmith --state ALL\n  bb --json pr list --project-key PROJECT --repository payments\n",
        )
        .action(async (options: ListOptions, command: Command) => {
            if (options.author !== undefined && !options.author.trim())
                throw new Error("Author filter cannot be empty.");
            const repository = resolveRepositoryContext(
                context.config,
                () => context.gitClient,
                options,
            );
            const views = await listPullRequestViews(context.bitbucketClient, {
                ...repository,
                state: options.state,
                author: options.author,
            });
            if (usesJsonOutput(command))
                writeJsonResult("pr list", { pullRequests: views.map(toPullRequestViewOutput) });
            else
                console.log(
                    views.length
                        ? views.map(formatPullRequestView).join("\n\n")
                        : "No Pull Requests found.",
                );
        });
    pr.command("show")
        .description(
            "Show a Pull Request by numeric ID or Bitbucket web URL, including its open tasks.",
        )
        .argument("<id-or-url>", "Pull Request ID or HTTP(S) URL")
        .option("--json", "Output a versioned JSON result for scripts and CI")
        .option("--project-key <key>", "Override the detected or configured Bitbucket project")
        .option("--repository <slug>", "Override the repository detected from the Git remote")
        .addHelpText(
            "after",
            "\nExamples:\n  bb pr show 42\n  bb pr show 42 --project-key PROJECT --repository payments\n  bb --json pr show https://bitbucket.company.com/projects/PROJECT/repos/payments/pull-requests/42\n",
        )
        .action(async (value: string, options: RepositoryOptions, command: Command) => {
            const reference = parsePullRequestReference(value);
            const identity = resolvePullRequestIdentity(
                context.config,
                () => context.gitClient,
                reference,
                options,
            );
            const view = await showPullRequestView(context.bitbucketClient, identity);
            if (usesJsonOutput(command))
                writeJsonResult("pr show", { pullRequest: toPullRequestViewOutput(view) });
            else console.log(formatPullRequestView(view));
        });
}
