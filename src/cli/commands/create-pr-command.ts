import { Option } from "commander";
import type { Command } from "commander";

import { createPullRequest } from "../../bitbucket/pull-requests.ts";
import { resolvePullRequestBranches } from "../../pull-request/branches.ts";
import { buildPullRequestContent } from "../../pull-request/pull-request-content.ts";
import { resolvePullRequestReviewers } from "../../pull-request/reviewers.ts";
import { resolveRepositoryContext } from "../../repository/repository-context.ts";
import type { CommandContext } from "../command-context.ts";

type CreatePrOptions = {
    sourceBranch?: string;
    targetBranch?: string;
    title?: string;
    projectKey?: string;
    repository?: string;
    reviewer: string[];
    reviewers: boolean;
};

export function registerCreatePrCommand(program: Command, context: CommandContext): void {
    program
        .command("create-pr")
        .description("Create a Pull Request on Bitbucket.")
        .argument("[source]", "Source branch, or target branch when used alone")
        .argument("[target]", "Target branch")
        .option("--source-branch <branch>", "Source branch")
        .option("--target-branch <branch>", "Target branch")
        .option("--title <title>", "Override the generated Pull Request title")
        .option("--project-key <key>", "Override the detected or configured Bitbucket project")
        .option("--repository <slug>", "Override the repository detected from the Git remote")
        .option(
            "--reviewer <name>",
            "Add a reviewer; can be specified multiple times or as a comma-separated list",
            collectReviewer,
            [],
        )
        .addOption(
            new Option("--no-reviewers", "Create the Pull Request without reviewers").conflicts(
                "reviewer",
            ),
        )
        .addHelpText(
            "after",
            `
Examples:
  bb create-pr develop
  bb create-pr feature/my-change develop
  bb create-pr --target-branch develop
  bb create-pr --source-branch feature/my-change --target-branch develop
  bb create-pr develop --title "Custom title"
  bb create-pr develop --reviewer mario --reviewer luca
  bb create-pr develop --reviewer mario,luca
  bb create-pr develop --no-reviewers
  bb create-pr develop --project-key PROJECT --repository payments
  bb -C C:\\repository create-pr develop
`,
        )
        .action(
            async (
                source: string | undefined,
                target: string | undefined,
                options: CreatePrOptions,
            ) => {
                await executeCreatePr(source, target, options, context);
            },
        );
}

async function executeCreatePr(
    source: string | undefined,
    target: string | undefined,
    options: CreatePrOptions,
    context: CommandContext,
): Promise<void> {
    const branches = resolvePullRequestBranches(
        source,
        target,
        () => context.gitClient.currentBranch(),
        options,
    );

    const reviewers = resolvePullRequestReviewers(
        options.reviewer,
        options.reviewers === false,
        context.config.bitbucket.defaultReviewers,
    );

    const repositoryContext = resolveRepositoryContext(context.config, () => context.gitClient, {
        projectKey: options.projectKey,
        repository: options.repository,
    });

    const remote = context.config.git.remote;

    // Update remote references before validating branches
    // and generating Pull Request content.
    context.gitClient.fetch(remote);

    context.gitClient.assertRemoteBranchExists(branches.sourceBranch, "source", remote);

    context.gitClient.assertRemoteBranchExists(branches.targetBranch, "target", remote);

    const sourceRef = `refs/remotes/${remote}/${branches.sourceBranch}`;
    const targetRef = `refs/remotes/${remote}/${branches.targetBranch}`;
    const commits = context.gitClient.commitsBetween(targetRef, sourceRef);

    if (commits.length === 0) {
        throw new Error(`No commits found between '${targetRef}' and '${sourceRef}'.`);
    }

    const content = buildPullRequestContent(commits, branches.sourceBranch);

    const pullRequest = await createPullRequest(context.bitbucketClient, {
        projectKey: repositoryContext.projectKey,

        repository: repositoryContext.repository,

        sourceBranch: branches.sourceBranch,

        targetBranch: branches.targetBranch,

        title: options.title?.trim() || content.title,

        description: content.description,

        reviewers,
    });

    const url = pullRequest.links.self[0]?.href;

    if (!url) {
        throw new Error("Bitbucket did not provide the created Pull Request URL.");
    }

    console.log(url);
}

function collectReviewer(value: string, previous: string[]): string[] {
    const reviewers = value
        .split(",")
        .map((reviewer) => reviewer.trim())
        .filter(Boolean);

    return [...previous, ...reviewers];
}
