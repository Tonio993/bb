import type {
    Command,
} from "commander";

import {
    createPullRequest,
} from "../bitbucket/pull-requests.ts";

import type {
    CommandContext,
} from "../cli/command-context.ts";

import {
    getPullRequestContent,
} from "../pullrequest/pull-request-content.ts";

import {
    resolvePullRequestBranches,
} from "../pullrequest/branches.ts";

import {
    resolvePullRequestReviewers,
} from "../pullrequest/reviewers.ts";

import {
    resolveRepositoryContext,
} from "../repository/repository-context.ts";


type CreatePrOptions = {
    title?: string;
    projectKey?: string;
    reviewer: string[];
    reviewers: boolean;
};


export function registerCreatePrCommand(
    program: Command,
    context: CommandContext,
): void {
    program
        .command("create-pr")
        .description(
            "Create a Pull Request on Bitbucket.",
        )
        .argument(
            "[source]",
            "Source branch, or target branch when used alone",
        )
        .argument(
            "[target]",
            "Target branch",
        )
        .option(
            "--title <title>",
            "Override the generated Pull Request title",
        )
        .option(
            "--project-key <key>",
            "Override the configured Bitbucket project",
        )
        .option(
            "--reviewer <name>",
            "Add a reviewer; can be specified multiple times or as a comma-separated list",
            collectReviewer,
            [],
        )
        .option(
            "--no-reviewers",
            "Create the Pull Request without reviewers",
        )
        .addHelpText(
            "after",
            `
Examples:
  bb create-pr develop
  bb create-pr feature/my-change develop
  bb create-pr develop --title "Custom title"
  bb create-pr develop --reviewer mario --reviewer luca
  bb create-pr develop --reviewer mario,luca
  bb create-pr develop --no-reviewers
  bb -C C:\\repository create-pr develop
`,
        )
        .action(
            async (
                source: string | undefined,
                target: string | undefined,
                options: CreatePrOptions,
            ) => {
                await executeCreatePr(
                    source,
                    target,
                    options,
                    context,
                );
            },
        );
}


async function executeCreatePr(
    source: string | undefined,
    target: string | undefined,
    options: CreatePrOptions,
    context: CommandContext,
): Promise<void> {
    const branches =
        resolvePullRequestBranches(
            source,
            target,
            () =>
                context.gitClient.currentBranch(),
        );

    const repositoryContext =
        resolveRepositoryContext(
            context.config,
            context.gitClient,
            {
                projectKey:
                    options.projectKey,
            },
        );

    const remote =
        context.config.git.remote;


    // Update remote references before validating branches
    // and generating Pull Request content.
    context.gitClient.fetch(
        remote,
    );


    context.gitClient.assertRemoteBranchExists(
        branches.sourceBranch,
        "source",
        remote,
    );

    context.gitClient.assertRemoteBranchExists(
        branches.targetBranch,
        "target",
        remote,
    );


    const content =
        getPullRequestContent(
            context.gitClient,
            branches.sourceBranch,
            branches.targetBranch,
            remote,
        );


    const reviewers =
        resolvePullRequestReviewers(
            options.reviewer,
            options.reviewers === false,
            context.config.bitbucket.defaultReviewers,
        );


    const pullRequest =
        await createPullRequest(
            context.bitbucketClient,
            {
                projectKey:
                    repositoryContext.projectKey,

                repository:
                    repositoryContext.repository,

                sourceBranch:
                    branches.sourceBranch,

                targetBranch:
                    branches.targetBranch,

                title:
                    options.title?.trim() ||
                    content.title,

                description:
                    content.description,

                reviewers,
            },
        );


    const url =
        pullRequest.links.self[0]?.href;

    if (!url) {
        throw new Error(
            "Bitbucket did not provide the created Pull Request URL.",
        );
    }

    console.log(url);
}


function collectReviewer(
    value: string,
    previous: string[],
): string[] {
    const reviewers =
        value
            .split(",")
            .map(
                (reviewer) =>
                    reviewer.trim(),
            )
            .filter(Boolean);

    return [
        ...previous,
        ...reviewers,
    ];
}
