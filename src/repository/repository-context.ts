import type { BbConfig } from "../config/config-schema.ts";
import type { GitClient } from "../git/git-client.ts";

export type RepositoryContext = {
    projectKey: string;
    repository: string;
};

export type ResolveRepositoryContextOptions = {
    projectKey?: string;
    repository?: string;
};

export function resolveRepositoryContext(
    config: BbConfig,
    gitClient: Pick<GitClient, "currentRepository">,
    options: ResolveRepositoryContextOptions = {},
): RepositoryContext {
    const projectKey = options.projectKey?.trim() || config.bitbucket.projectKey.trim();

    if (!projectKey) {
        throw new Error("Unable to determine the Bitbucket project.");
    }

    const repository = options.repository?.trim() || gitClient.currentRepository();

    if (!repository) {
        throw new Error("Unable to determine the current repository.");
    }

    return {
        projectKey,
        repository,
    };
}
