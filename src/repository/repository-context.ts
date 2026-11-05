import type { GitClient } from "../git/git-client.ts";
import { normalizeBitbucketUrl } from "../config/bitbucket-url.ts";
import { normalizeSshHostnames } from "../config/ssh-hostnames.ts";
import { parseBitbucketRemoteUrl } from "./remote-url.ts";
import type { ParsedBitbucketRemote } from "./remote-url-types.ts";
import type {
    RepositoryContext,
    RepositoryContextConfig,
    ResolveRepositoryContextOptions,
} from "./repository-types.ts";

export function resolveRepositoryContext(
    config: RepositoryContextConfig,
    getGitClient: () => Pick<GitClient, "remoteFetchUrl">,
    options: ResolveRepositoryContextOptions = {},
): RepositoryContext {
    const projectOverride = options.projectKey?.trim();
    const repositoryOverride = options.repository?.trim();
    // An explicitly selected repository can use the configured project without discovery.
    if (repositoryOverride) {
        const projectKey = projectOverride || config.bitbucket.projectKey?.trim();
        if (projectKey) return { projectKey, repository: repositoryOverride };
    }
    const server = new URL(normalizeBitbucketUrl(config.bitbucket.url));
    const contextPath = normalizeContextPath(server.pathname);
    const remote = parseBitbucketRemoteUrl(getGitClient().remoteFetchUrl(config.git.remote));
    assertRemoteMatchesServer(
        remote,
        server,
        contextPath,
        options.sshHostnames ?? config.bitbucket.sshHostnames ?? [],
    );
    return {
        projectKey: projectOverride || remote.projectKey,
        repository: repositoryOverride || remote.repository,
    };
}

function assertRemoteMatchesServer(
    remote: ParsedBitbucketRemote,
    server: URL,
    contextPath: string,
    sshHostnames: readonly string[],
): void {
    if (remote.protocol === "ssh") {
        if (remote.hostname === server.hostname.toLowerCase()) return;
        if (normalizeSshHostnames(sshHostnames).includes(remote.hostname)) return;
        throw new Error(
            "The Git SSH remote does not match the configured Bitbucket hostname. Specify '--project-key' and '--repository', or configure 'bitbucket.sshHostnames'.",
        );
    }
    if (
        remote.hostname !== server.hostname.toLowerCase() ||
        remote.protocol + ":" !== server.protocol ||
        remote.port !== (server.port ? Number(server.port) : undefined) ||
        remote.contextPath !== contextPath
    ) {
        throw new Error(
            "The Git HTTP remote does not match the configured Bitbucket server and context path. Check 'bitbucket.url' and 'git.remote'.",
        );
    }
}

function normalizeContextPath(path: string): string {
    try {
        return path
            .split("/")
            .map((part) => encodeURIComponent(decodeURIComponent(part)))
            .join("/")
            .replace(/\/+$/, "");
    } catch {
        throw new Error("Invalid Bitbucket context path. Check 'bitbucket.url'.");
    }
}
