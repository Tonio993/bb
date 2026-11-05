import type { GitClient } from "../git/git-client.ts";
import type { PullRequestIdentity } from "../bitbucket/pull-request-types.ts";
import { normalizeBitbucketUrl, normalizeBitbucketContextPath } from "../config/bitbucket-url.ts";
import { resolveRepositoryContext } from "./repository-context.ts";
import type {
    PullRequestReference,
    RepositoryContextConfig,
    ResolveRepositoryContextOptions,
} from "./repository-types.ts";

export function parsePullRequestReference(value: string): PullRequestReference {
    try {
        const input = value.trim();
        if (/^\d+$/.test(input)) return { kind: "id", pullRequestId: positiveId(input) };
        if (!/^https?:\/\//i.test(input) || /[\\\s\p{Cc}]/u.test(input)) throw new Error();
        const url = new URL(input);
        if (url.username || url.password || /[%*]/.test(url.hostname)) throw new Error();
        // Read the original path: URL silently collapses dot segments.
        const path = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(input)?.[1] ?? "";
        const parts = path
            .replace(/^\//, "")
            .replace(/\/$/, "")
            .split("/")
            .map((part) => {
                const decoded = decodeURIComponent(part);
                if (
                    !decoded ||
                    decoded === "." ||
                    decoded === ".." ||
                    /[\\/:%\s\p{Cc}?#]/u.test(decoded)
                )
                    throw new Error();
                return decoded;
            });
        if (["overview", "diff", "commits", "activities", "activity"].includes(parts.at(-1) ?? ""))
            parts.pop();
        if (
            parts.length < 6 ||
            !["projects", "users"].includes(parts.at(-6)!) ||
            parts.at(-4) !== "repos" ||
            parts.at(-2) !== "pull-requests"
        )
            throw new Error();
        const projectKey = (parts.at(-6) === "users" ? "~" : "") + parts.at(-5)!;
        const repository = parts.at(-3)!;
        if (
            !/^(?:[a-z0-9][a-z0-9_-]*|~[a-z0-9][a-z0-9._-]*)$/i.test(projectKey) ||
            !/^[a-z0-9._-]+$/i.test(repository) ||
            repository === "." ||
            repository === ".."
        )
            throw new Error();
        return {
            kind: "url",
            pullRequestId: positiveId(parts.at(-1)!),
            projectKey,
            repository,
            origin: url.origin,
            contextPath:
                parts.length === 6
                    ? ""
                    : "/" + parts.slice(0, -6).map(encodeURIComponent).join("/"),
        };
    } catch {
        throw new Error(
            "Invalid Pull Request reference. Use a positive numeric ID or a Bitbucket HTTP(S) Pull Request URL.",
        );
    }
}

function positiveId(value: string): number {
    const id = /^\d+$/.test(value) ? Number(value) : 0;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error();
    return id;
}

export function resolvePullRequestIdentity(
    config: RepositoryContextConfig,
    getGitClient: () => Pick<GitClient, "remoteFetchUrl">,
    reference: PullRequestReference,
    options: ResolveRepositoryContextOptions = {},
): PullRequestIdentity {
    if (reference.kind === "id")
        return {
            ...resolveRepositoryContext(config, getGitClient, options),
            pullRequestId: reference.pullRequestId,
        };
    const server = new URL(normalizeBitbucketUrl(config.bitbucket.url));
    if (
        server.origin !== reference.origin ||
        normalizeBitbucketContextPath(server.pathname) !== reference.contextPath
    ) {
        throw new Error(
            "The Pull Request URL does not match the configured Bitbucket server and context path.",
        );
    }
    if (
        (options.projectKey?.trim() &&
            options.projectKey.trim().toLowerCase() !== reference.projectKey.toLowerCase()) ||
        (options.repository?.trim() &&
            options.repository.trim().toLowerCase() !== reference.repository.toLowerCase())
    ) {
        throw new Error("Project or repository overrides conflict with the Pull Request URL.");
    }
    return {
        projectKey: reference.projectKey,
        repository: reference.repository,
        pullRequestId: reference.pullRequestId,
    };
}
