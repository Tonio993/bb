import type { TokenStore } from "../../auth/token-store.ts";
import type { BitbucketApi } from "../../bitbucket/bitbucket-client.ts";
import type { ConfigStore } from "../../config/config-store.ts";
import { diagnoseCredentials } from "./credential-diagnostics.ts";
import { diagnoseLocalEnvironment } from "./local-diagnostics.ts";
import type { DoctorCheck, DoctorOptions } from "./doctor-types.ts";
import { diagnoseRemoteAccess } from "./remote-diagnostics.ts";

type DoctorDependencies = {
    nodeVersion: string;
    npmVersion: () => string;
    gitVersion: () => string;
    configStore: Pick<ConfigStore, "path" | "exists" | "snapshot" | "get">;
    tokenStore: Pick<TokenStore, "describeSource" | "inspectCredential">;
    toolAvailable: (command: string) => boolean;
    createRemoteClient: (url: string) => Pick<BitbucketApi, "get">;
};

export async function runDoctor(
    dependencies: DoctorDependencies,
    options: DoctorOptions = {},
): Promise<DoctorCheck[]> {
    const { checks: results, serverUrl: url } = diagnoseLocalEnvironment(
        dependencies,
        options.remote,
    );
    const credentials = diagnoseCredentials(
        {
            tokenStore: dependencies.tokenStore,
            toolAvailable: dependencies.toolAvailable,
            cacheToken: Boolean(options.remote && url),
        },
        Boolean(options.checkToken || (options.remote && url)),
    );
    results.push(...credentials.checks);
    if (!options.remote) return results;
    if (!url) {
        results.push(
            {
                name: "Remote connection",
                status: "FAIL",
                message:
                    "A valid bitbucket.url is required. Run 'bb config init' or check the configuration file.",
            },
            {
                name: "Remote authentication",
                status: "SKIP",
                message: "No remote request was made because the server URL is missing or invalid.",
            },
        );
    } else if (!credentials.readyForRemote) {
        results.push(
            {
                name: "Remote connection",
                status: "SKIP",
                message: "No remote request was made because credential checks failed.",
            },
            {
                name: "Remote authentication",
                status: "SKIP",
                message: "Resolve the reported credential problems and run the command again.",
            },
        );
    } else {
        const serverUrl = url;
        results.push(
            ...(await diagnoseRemoteAccess(() => dependencies.createRemoteClient(serverUrl))),
        );
    }
    return results;
}
