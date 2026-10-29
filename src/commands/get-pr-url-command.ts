import type {
    Command,
} from "commander";

import type {
    CommandContext,
} from "../cli/command-context.ts";

import {
    getOpenPullRequest,
} from "../bitbucket/pull-requests.ts";

import {
    resolvePullRequestBranches,
} from "../pullrequest/branches.ts";

import {
    resolveRepositoryContext,
} from "../repository/repository-context.ts";

type GetPrUrlOptions = {
    sourceBranch?: string;
    targetBranch?: string;
    projectKey?: string;
};


export function registerGetPrUrlCommand(
    program: Command,
    context: CommandContext,
): void {
    program
        .command("get-pr-url")
        .description(
            "Get the URL of an open Pull Request.",
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
            "--source-branch <branch>",
            "Source branch",
        )
        .option(
            "--target-branch <branch>",
            "Target branch",
        )
        .option(
            "--project-key <key>",
            "Override the configured Bitbucket project",
        )
        .addHelpText(
            "after",
            `
Examples:
  bb get-pr-url develop
  bb get-pr-url feature/my-change develop
  bb get-pr-url --target-branch develop
  bb get-pr-url develop --project-key PROJECT
  bb -C C:\\repository get-pr-url develop
`,
        )
        .action(
            async (
                source: string | undefined,
                target: string | undefined,
                options: GetPrUrlOptions,
            ) => {
                await executeGetPrUrl(
                    source,
                    target,
                    options,
                    context,
                );
            },
        );
}


async function executeGetPrUrl(
    source: string | undefined,
    target: string | undefined,
    options: GetPrUrlOptions,
    context: CommandContext,
): Promise<void> {
    const branches =
        resolvePullRequestBranches(
            source,
            target,
            () => context.gitClient.currentBranch(),
            options,
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

    const pullRequest =
        await getOpenPullRequest(
            context.bitbucketClient,
            {
                projectKey: repositoryContext.projectKey,
                repository: repositoryContext.repository,
                sourceBranch: branches.sourceBranch,
                targetBranch: branches.targetBranch,
            },
        );

    if (!pullRequest) {
        return;
    }

    const url =
        pullRequest.links.self[0]?.href;

    if (!url) {
        throw new Error(
            "Bitbucket did not provide the Pull Request URL.",
        );
    }

    console.log(url);
}
