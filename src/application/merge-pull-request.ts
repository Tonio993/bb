import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";
import type { BitbucketPullRequest } from "../bitbucket/bitbucket-types.ts";
import {
    getOpenPullRequest,
    getPullRequest,
    getPullRequestCommitMessageSuggestion,
    mergePullRequest,
} from "../bitbucket/pull-requests.ts";
import type {
    GetOpenPullRequestOptions,
    MergePullRequestBody,
    PullRequestIdentity,
} from "../bitbucket/pull-requests.ts";
import {
    getPullRequestTask,
    getPullRequestTasks,
    resolvePullRequestTask,
} from "../bitbucket/pull-request-tasks.ts";
import { buildMergeCommitMessage } from "../pullrequest/merge-commit-message.ts";
import {
    assertPullRequestCanMerge,
    shouldCompletePullRequestTask,
} from "../pullrequest/merge-validation.ts";

export type MergeOpenPullRequestOptions = GetOpenPullRequestOptions & {
    messagePrefix?: string;
    completeTasks?: boolean;
};

export async function mergeOpenPullRequest(
    client: BitbucketApi,
    options: MergeOpenPullRequestOptions,
): Promise<BitbucketPullRequest> {
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

    const identity: PullRequestIdentity = {
        projectKey: pullRequest.toRef.repository.project.key,
        repository: pullRequest.toRef.repository.slug,
        pullRequestId: pullRequest.id,
    };
    let currentPullRequest = pullRequest;
    if (options.completeTasks) {
        await completePullRequestTasks(client, identity);
        currentPullRequest = await getPullRequest(client, identity);
        if (
            currentPullRequest.fromRef.id !== pullRequest.fromRef.id ||
            currentPullRequest.toRef.id !== pullRequest.toRef.id
        ) {
            throw new Error(
                "Pull Request branches changed while completing tasks. Run the command again.",
            );
        }
        assertPullRequestCanMerge(currentPullRequest);
    }

    const body: MergePullRequestBody = { version: currentPullRequest.version };
    if (options.messagePrefix?.trim()) {
        const suggestion = await getPullRequestCommitMessageSuggestion(client, identity);
        body.message = buildMergeCommitMessage(suggestion, options.messagePrefix);
        body.autoSubject = false;
    }

    const merged = await mergePullRequest(client, identity, body);
    if (merged.state !== "MERGED") {
        throw new Error("Bitbucket did not confirm that the Pull Request was merged.");
    }
    return merged;
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
