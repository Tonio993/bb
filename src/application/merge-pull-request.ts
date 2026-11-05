import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";
import type { BitbucketPullRequest } from "../bitbucket/bitbucket-types.ts";
import { deleteBranch } from "../bitbucket/branches.ts";
import type { DeleteBranchOptions } from "../bitbucket/branch-types.ts";
import { getOpenPullRequest } from "../bitbucket/pull-request-search.ts";
import {
    getPullRequestTask,
    getPullRequestTasks,
    resolvePullRequestTask,
} from "../bitbucket/pull-request-tasks.ts";
import type { MergePullRequestBody, PullRequestIdentity } from "../bitbucket/pull-request-types.ts";
import {
    getPullRequest,
    getPullRequestCommitMessageSuggestion,
    mergePullRequest,
} from "../bitbucket/pull-requests.ts";
import { buildMergeCommitMessage } from "../pull-request/merge-commit-message.ts";
import {
    assertPullRequestCanMerge,
    assertSourceBranchCanBeDeleted,
    assertMergedSourceMatches,
    hasSamePullRequestBranches,
    shouldCompletePullRequestTask,
} from "../pull-request/merge-validation.ts";
import type {
    MergeOpenPullRequestOptions,
    MergeOpenPullRequestResult,
} from "./merge-pull-request-types.ts";

export async function mergeOpenPullRequest(
    client: BitbucketApi,
    options: MergeOpenPullRequestOptions,
): Promise<MergeOpenPullRequestResult> {
    const match = await getOpenPullRequest(client, options);
    if (!match) {
        throw new Error(
            `No open Pull Request found from '${options.sourceBranch}' to '${options.targetBranch}'.`,
        );
    }

    const pullRequest = await getPullRequest(client, {
        projectKey: options.projectKey,
        repository: options.repository,
        pullRequestId: match.id,
    });
    if (
        pullRequest.fromRef.id !== `refs/heads/${options.sourceBranch}` ||
        pullRequest.toRef.id !== `refs/heads/${options.targetBranch}`
    ) {
        throw new Error("Pull Request branches changed after discovery. Run the command again.");
    }
    assertPullRequestCanMerge(pullRequest);
    if (options.deleteSource) assertSourceBranchCanBeDeleted(pullRequest);

    const identity: PullRequestIdentity = {
        projectKey: pullRequest.toRef.repository.project.key,
        repository: pullRequest.toRef.repository.slug,
        pullRequestId: pullRequest.id,
    };
    let currentPullRequest: BitbucketPullRequest = pullRequest;
    if (options.completeTasks) {
        await completePullRequestTasks(client, identity);
        currentPullRequest = await getPullRequest(client, identity);
        if (!hasSamePullRequestBranches(pullRequest, currentPullRequest)) {
            throw new Error(
                "Pull Request branches changed while completing tasks. Run the command again.",
            );
        }
        assertPullRequestCanMerge(currentPullRequest);
    }

    let sourceDeletion: DeleteBranchOptions | undefined;
    if (options.deleteSource) {
        assertSourceBranchCanBeDeleted(currentPullRequest);
        sourceDeletion = {
            projectKey: currentPullRequest.fromRef.repository.project.key,
            repository: currentPullRequest.fromRef.repository.slug,
            name: currentPullRequest.fromRef.id,
            endPoint: currentPullRequest.fromRef.latestCommit,
        };
    }

    const body: MergePullRequestBody = { version: currentPullRequest.version };
    if (options.messagePrefix?.trim()) {
        const suggestion = await getPullRequestCommitMessageSuggestion(client, identity);
        body.message = buildMergeCommitMessage(suggestion, options.messagePrefix);
        body.autoSubject = false;
    }

    const merged = await mergePullRequest(client, identity, body);
    if (merged.state !== "MERGED" || merged.id !== identity.pullRequestId) {
        throw new Error("Bitbucket did not confirm that the Pull Request was merged.");
    }
    if (!sourceDeletion) return { pullRequest: merged, sourceDeletion: "not-requested" };
    try {
        assertMergedSourceMatches(currentPullRequest, merged);
        await deleteBranch(client, sourceDeletion);
        return { pullRequest: merged, sourceDeletion: "deleted" };
    } catch (error) {
        return {
            pullRequest: merged,
            sourceDeletion: "failed",
            error:
                error instanceof Error
                    ? error
                    : new Error("Unable to confirm source branch deletion."),
        };
    }
}

async function completePullRequestTasks(
    client: BitbucketApi,
    identity: PullRequestIdentity,
): Promise<void> {
    // Collect every page before updates so resolving tasks cannot shift subsequent pages.
    const tasks = await getPullRequestTasks(client, identity);
    for (const task of tasks) {
        if (task.state === "RESOLVED") continue;
        const current = await getPullRequestTask(client, identity, task.id);
        if (!shouldCompletePullRequestTask(current)) continue;
        const completed = await resolvePullRequestTask(client, identity, task.id, current.version);
        if (completed.state !== "RESOLVED") {
            throw new Error(
                `Bitbucket did not confirm completion of Pull Request task #${task.id}.`,
            );
        }
    }
}
