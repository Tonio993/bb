import type { TokenStore } from "../auth/token-store.ts";
import type { BitbucketApi } from "../bitbucket/bitbucket-client.ts";
import type { BbConfig } from "../config/config-schema.ts";
import type { ConfigStore } from "../config/config-store.ts";
import type { GitOperations } from "../git/git-types.ts";
import type { DoctorCheck, DoctorOptions } from "../application/doctor/doctor-types.ts";

export type CommandContext = {
    readonly doctor: (options?: DoctorOptions) => Promise<DoctorCheck[]>;
    readonly tokenStore: Pick<TokenStore, "inspectCredential" | "set" | "delete">;
    readonly configStore: Pick<ConfigStore, "path" | "get" | "set" | "save" | "snapshot">;

    readonly config: BbConfig;

    readonly bitbucketClient: BitbucketApi;

    readonly gitClient: GitOperations;
};
