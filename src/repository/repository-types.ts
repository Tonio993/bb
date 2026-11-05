import type { BbConfig } from "../config/config-schema.ts";

export type RepositoryContext = { projectKey: string; repository: string };

export type RepositoryContextConfig = {
    bitbucket: Pick<BbConfig["bitbucket"], "url"> &
        Partial<Pick<BbConfig["bitbucket"], "projectKey" | "sshHostnames">>;
    git: Pick<BbConfig["git"], "remote">;
};

export type ResolveRepositoryContextOptions = {
    projectKey?: string;
    repository?: string;
    sshHostnames?: readonly string[];
};
