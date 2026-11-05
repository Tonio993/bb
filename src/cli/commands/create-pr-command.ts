import { Option } from "commander";
import type { Command } from "commander";

import { createOrFindPullRequest } from "../../application/create-pull-request.ts";
import { loadDescriptionInput } from "../description-input.ts";
import { renderDescriptionTemplate } from "../../pull-request/description-template.ts";
import { resolvePullRequestBranches } from "../../pull-request/branches.ts";
import { buildPullRequestContent } from "../../pull-request/pull-request-content.ts";
import { resolvePullRequestReviewers } from "../../pull-request/reviewers.ts";
import { resolveRepositoryContext } from "../../repository/repository-context.ts";
import type { CommandContext } from "../command-context.ts";
import { usesJsonOutput, writeJsonResult } from "../json-output.ts";
import { toPullRequestOutput } from "../pull-request-output.ts";
import type { CreatePullRequestOptions } from "../../bitbucket/pull-request-types.ts";
import { formatCreatePreview } from "../pull-request-preview-output.ts";
import type {
    CreatePullRequestPreviewOutput,
    CreatePullRequestOutput,
} from "../json-output-types.ts";

type CreatePrOptions = {
    sourceBranch?: string;
    targetBranch?: string;
    title?: string;
    projectKey?: string;
    repository?: string;
    reviewer: string[];
    reviewers: boolean;
    dryRun?: boolean;
    descriptionFile?: string;
    template?: string | false;
    open?: boolean;
};

export function registerCreatePrCommand(program: Command, context: CommandContext): void {
    program
        .command("create-pr")
        .description("Create a Pull Request on Bitbucket.")
        .option("--json", "Output a versioned JSON result for scripts and CI")
        .option(
            "--dry-run",
            "Preview title, description, and reviewers after fetching Git refs; do not create a PR",
        )
        .argument("[source]", "Source branch, or target branch when used alone")
        .argument("[target]", "Target branch")
        .option("--source-branch <branch>", "Source branch")
        .option("--target-branch <branch>", "Target branch")
        .option("--title <title>", "Override the generated Pull Request title")
        .addOption(
            new Option(
                "--description-file <path>",
                "Use a UTF-8 file as the literal description",
            ).conflicts("template"),
        )
        .addOption(
            new Option("--template <path>", "Render a UTF-8 description template").conflicts([
                "descriptionFile",
            ]),
        )
        .option("--no-template", "Ignore the configured description template")
        .option(
            "--open",
            "Open the created or existing Pull Request in the browser; ignored in dry-run",
        )
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
                command: Command,
            ) => {
                await executeCreatePr(source, target, options, context, usesJsonOutput(command));
            },
        );
}

async function executeCreatePr(
    source: string | undefined,
    target: string | undefined,
    options: CreatePrOptions,
    context: CommandContext,
    json: boolean,
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
    const descriptionInput = loadDescriptionInput(
        options,
        context.config.bitbucket.descriptionTemplate,
    );

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

    const plan: CreatePullRequestOptions = {
        projectKey: repositoryContext.projectKey,

        repository: repositoryContext.repository,

        sourceBranch: branches.sourceBranch,

        targetBranch: branches.targetBranch,

        title: options.title?.trim() || content.title,

        description:
            descriptionInput === undefined
                ? content.description
                : descriptionInput.kind === "literal"
                  ? descriptionInput.content
                  : renderDescriptionTemplate(descriptionInput.content, {
                        ...repositoryContext,
                        ...branches,
                        title: options.title?.trim() || content.title,
                        commits: content.description,
                    }),

        reviewers,
    };
    if (options.dryRun) {
        const preview: CreatePullRequestPreviewOutput = {
            dryRun: true,
            plan,
            git: { remote, fetchPerformed: true },
        };
        if (json) writeJsonResult("create-pr", preview);
        else console.log(formatCreatePreview(plan, remote));
        return;
    }
    const { pullRequest, created } = await createOrFindPullRequest(context.bitbucketClient, plan);

    const url = pullRequest.links.self[0]?.href;

    if (!url) {
        throw new Error("Bitbucket did not provide the created Pull Request URL.");
    }

    let browser: "not-requested" | "opened" | "failed" = "not-requested";
    if (options.open) {
        try {
            const publicUrl = toPullRequestOutput(pullRequest).url;
            if (!publicUrl || !context.openUrl)
                throw new Error("The browser opener is unavailable.");
            await context.openUrl(publicUrl);
            browser = "opened";
        } catch {
            browser = "failed";
        }
    }
    const data: CreatePullRequestOutput = {
        pullRequest: toPullRequestOutput(pullRequest),
        created,
        browser,
    };
    if (json)
        writeJsonResult(
            "create-pr",
            data,
            browser === "failed"
                ? {
                      code: "BROWSER_OPEN_FAILED",
                      message:
                          "The Pull Request is available, but the browser could not be opened. Use the returned URL; do not repeat creation.",
                  }
                : null,
        );
    else {
        console.log(created ? url : "Existing Pull Request: " + url);
        if (browser === "failed") {
            console.error(
                "The Pull Request is available, but the browser could not be opened. Use the printed URL; do not repeat creation.",
            );
            process.exitCode = 1;
        }
    }
}

function collectReviewer(value: string, previous: string[]): string[] {
    const reviewers = value
        .split(",")
        .map((reviewer) => reviewer.trim())
        .filter(Boolean);

    return [...previous, ...reviewers];
}
