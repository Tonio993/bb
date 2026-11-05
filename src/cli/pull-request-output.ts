import type {
    BitbucketPullRequest,
    BitbucketPullRequestRef,
} from "../bitbucket/bitbucket-types.ts";
import type { PullRequestOutput } from "./json-output-types.ts";

export function toPullRequestOutput(pr: BitbucketPullRequest): PullRequestOutput {
    return {
        id: pr.id,
        version: pr.version,
        state: pr.state,
        url: publicUrl(pr.links.self[0]?.href),
        source: referenceOutput(pr.fromRef),
        target: referenceOutput(pr.toRef),
        reviewers: pr.reviewers.map(({ status }) => ({ status })),
    };
}

function publicUrl(href: string | undefined): string | null {
    if (!href) return null;
    try {
        const url = new URL(href);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.href;
    } catch {
        return null;
    }
}

function referenceOutput(ref: BitbucketPullRequestRef): PullRequestOutput["source"] {
    return {
        projectKey: ref.repository.project.key,
        repository: ref.repository.slug,
        branch: ref.displayId,
        ref: ref.id,
    };
}
