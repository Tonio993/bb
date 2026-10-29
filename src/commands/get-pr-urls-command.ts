import type {
    Command,
} from "commander";

import {
    getOpenPullRequests,
} from "../bitbucket/pull-requests.ts";

import type {
    CommandContext,
} from "../cli/command-context.ts";


type GetPrUrlsOptions = {
    projectKey?: string;
    repositoryFilter?: string;
};


export function registerGetPrUrlsCommand(
    program: Command,
    context: CommandContext,
): void {
    program
        .command("get-pr-urls")
        .description(
            "Get the URLs of open Pull Requests across project repositories.",
        )
        .argument(
            "<source>",
            "Source branch",
        )
        .argument(
            "<target>",
            "Target branch",
        )
        .option(
            "--project-key <key>",
            "Override the configured Bitbucket project",
        )
        .option(
            "--repository-filter <pattern>",
            "Filter repositories by name or slug using wildcards",
        )
        .addHelpText(
            "after",
            `
Examples:
  bb get-pr-urls feature/ABC-123 develop
  bb get-pr-urls feature/ABC-123 develop --repository-filter "service-*"
  bb get-pr-urls feature/ABC-123 develop --repository-filter "*payment*"
  bb get-pr-urls feature/ABC-123 develop --project-key PROJECT
`,
        )
        .action(
            async (
                source: string,
                target: string,
                options: GetPrUrlsOptions,
            ) => {
                await executeGetPrUrls(
                    source,
                    target,
                    options,
                    context,
                );
            },
        );
}


async function executeGetPrUrls(
    sourceBranch: string,
    targetBranch: string,
    options: GetPrUrlsOptions,
    context: CommandContext,
): Promise<void> {
    const projectKey =
        options.projectKey?.trim() ||
        context.config.bitbucket.projectKey;

    const pullRequests =
        await getOpenPullRequests(
            context.bitbucketClient,
            {
                projectKey,
                sourceBranch,
                targetBranch,
                repositoryFilter: options.repositoryFilter,
            },
        );

    for (const pullRequest of pullRequests) {
        const url =
            pullRequest.links.self[0]?.href;

        if (!url) {
            throw new Error(
                `Bitbucket did not provide the URL for ` +
                `Pull Request #${pullRequest.id} ` +
                `in repository '${pullRequest.repository.slug}'.`,
            );
        }

        console.log(url);
    }
}
