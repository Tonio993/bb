import type { PullRequestView } from "../application/pull-request-view-types.ts";
import type { BitbucketUser } from "../bitbucket/bitbucket-types.ts";
import type { PullRequestViewOutput } from "./json-output-types.ts";
import { toPullRequestOutput } from "./pull-request-output.ts";

export function toPullRequestViewOutput(view: PullRequestView): PullRequestViewOutput {
    const pr = view.pullRequest;
    return {
        ...toPullRequestOutput(pr),
        title: pr.title,
        author: publicUser(pr.author.user),
        reviewers: pr.reviewers.map((reviewer) => ({
            status: reviewer.status,
            user: reviewer.user ? publicUser(reviewer.user) : null,
        })),
        openTasks: view.openTasks.map((task) => ({ id: task.id, text: task.text ?? null })),
    };
}

function publicUser(user: BitbucketUser): BitbucketUser {
    return {
        ...(user.name === undefined ? {} : { name: user.name }),
        ...(user.slug === undefined ? {} : { slug: user.slug }),
        ...(user.displayName === undefined ? {} : { displayName: user.displayName }),
    };
}

export function formatPullRequestView(view: PullRequestView): string {
    const pr = toPullRequestViewOutput(view);
    const reviewers = pr.reviewers
        .map((reviewer) => `${userLabel(reviewer.user)}: ${line(reviewer.status)}`)
        .join(", ");
    return [
        `#${pr.id} ${line(pr.state)} - ${line(pr.title)}`,
        `Author: ${userLabel(pr.author)}`,
        `Source: ${line(pr.source.projectKey)}/${line(pr.source.repository)} ${line(pr.source.branch)}`,
        `Target: ${line(pr.target.projectKey)}/${line(pr.target.repository)} ${line(pr.target.branch)}`,
        `Reviewers: ${reviewers || "none"}`,
        `Open tasks: ${pr.openTasks.length}`,
        ...pr.openTasks.map((task) => `  #${task.id} ${line(task.text ?? "(text unavailable)")}`),
        `URL: ${pr.url ?? "(unavailable)"}`,
    ].join("\n");
}

function userLabel(user: BitbucketUser | null): string {
    if (!user) return "(unknown user)";
    const login = user.name ?? user.slug ?? "(unknown user)";
    return line(
        user.displayName && user.displayName !== login ? `${user.displayName} (${login})` : login,
    );
}
function line(value: string): string {
    return value
        .replace(/[\p{Cc}\p{Cf}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
