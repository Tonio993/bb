import type { TokenStore } from "../auth/token-store.ts";

import type {
    BitbucketClient,
} from "../bitbucket/bitbucket-client.ts";

import type {
    BbConfig,
    ConfigStore,
} from "../config/config.ts";

import type {
    GitClient,
} from "../git/git-client.ts";


export type CommandContext = {
    readonly tokenStore: TokenStore;
    readonly configStore: ConfigStore;

    readonly config: BbConfig;

    readonly bitbucketClient:
        BitbucketClient;

    readonly gitClient:
        GitClient;
};
