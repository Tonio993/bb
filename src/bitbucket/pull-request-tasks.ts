import type { BitbucketClient } from "./bitbucket-client.ts";
import type { BitbucketPullRequestTask } from "./bitbucket-types.ts";
import { iterateBitbucketPages } from "./pagination.ts";
import { getPullRequestPath } from "./pull-requests.ts";
import type { PullRequestIdentity } from "./pull-requests.ts";
import { parseTask } from "./response-parsers.ts";

export async function getPullRequestTasks(
    client: BitbucketClient,
    identity: PullRequestIdentity,
): Promise<BitbucketPullRequestTask[]> {
    const tasks: BitbucketPullRequestTask[] = [];
    for await (const page of iterateBitbucketPages(
        client, `${getPullRequestPath(identity)}/blocker-comments`, parseTask, "Pull Request task",
    )) {
        tasks.push(...page.values);
    }
    return tasks;
}

export async function getPullRequestTask(
    client: BitbucketClient,
    identity: PullRequestIdentity,
    taskId: number,
): Promise<BitbucketPullRequestTask> {
    return client.get(getTaskPath(identity, taskId), parseTask);
}

export async function resolvePullRequestTask(
    client: BitbucketClient,
    identity: PullRequestIdentity,
    taskId: number,
    version: number,
): Promise<BitbucketPullRequestTask> {
    return client.put(getTaskPath(identity, taskId), { version, state: "RESOLVED" }, parseTask);
}

function getTaskPath(identity: PullRequestIdentity, taskId: number): string {
    if (!Number.isInteger(taskId) || taskId <= 0) {
        throw new Error("Bitbucket did not provide a valid Pull Request task ID.");
    }
    return `${getPullRequestPath(identity)}/comments/${taskId}`;
}
