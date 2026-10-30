import type { TokenStore } from "../auth/token-store.ts";

import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";

import type { BbConfig, ConfigStore } from "../config/config.ts";

import type { GitOperations } from "../git/git-client.ts";

export type CommandContext = {
    readonly tokenStore: Pick<TokenStore, "source" | "set" | "delete">;
    readonly configStore: Pick<ConfigStore, "path" | "get" | "set" | "save" | "snapshot">;

    readonly config: BbConfig;

    readonly bitbucketClient: BitbucketApi;

    readonly gitClient: GitOperations;
};
