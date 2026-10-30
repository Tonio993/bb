import type { TokenStore } from "../auth/token-store.ts";
import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";
import type { BbConfig } from "../config/config-schema.ts";
import type { ConfigStore } from "../config/config-store.ts";
import type { GitOperations } from "../git/git-types.ts";

export type CommandContext = {
    readonly tokenStore: Pick<TokenStore, "source" | "set" | "delete">;
    readonly configStore: Pick<ConfigStore, "path" | "get" | "set" | "save" | "snapshot">;

    readonly config: BbConfig;

    readonly bitbucketClient: BitbucketApi;

    readonly gitClient: GitOperations;
};
