#!/usr/bin/env node
import { CommanderError } from "commander";

import { createTokenBackend } from "./auth/token-backends.ts";
import { TokenStore } from "./auth/token-store.ts";
import { BitbucketClient } from "./bitbucket/bitbucket-client.ts";
import { runCli } from "./cli/cli.ts";
import type { CommandContext } from "./cli/command-context.ts";
import { ConfigStore } from "./config/config-store.ts";
import { GitClient } from "./git/git-client.ts";
import { runDoctor } from "./application/doctor/run-doctor.ts";
import { readNpmVersion } from "./diagnostics/npm-version.ts";
import { isExecutableAvailable } from "./diagnostics/executable.ts";
import { openUrl } from "./browser/open-url.ts";

const configStore = new ConfigStore();

const tokenStore = new TokenStore(createTokenBackend());

let cachedConfig: ReturnType<ConfigStore["loadRequired"]> | undefined;

let cachedBitbucketClient: BitbucketClient | undefined;

let cachedGitClient: GitClient | undefined;

const getConfig = () => {
    cachedConfig ??= configStore.loadRequired();

    return cachedConfig;
};

const context: CommandContext = {
    openUrl,
    doctor: (options = {}) =>
        runDoctor(
            {
                nodeVersion: process.versions.node,
                npmVersion: readNpmVersion,
                gitVersion: () =>
                    new GitClient(
                        "origin",
                        () => tokenStore.get(),
                        () => undefined,
                    ).version(),
                configStore,
                tokenStore,
                toolAvailable: isExecutableAvailable,
                createRemoteClient: (url) =>
                    new BitbucketClient(url, () => tokenStore.get(), {
                        timeoutMs: 10000,
                        redirect: "manual",
                    }),
            },
            options,
        ),
    tokenStore,
    configStore,

    get config() {
        return getConfig();
    },

    get bitbucketClient() {
        cachedBitbucketClient ??= new BitbucketClient(getConfig().bitbucket.url, () =>
            tokenStore.get(),
        );

        return cachedBitbucketClient;
    },

    get gitClient() {
        if (!cachedGitClient) {
            const remote = configStore.get("git.remote");

            cachedGitClient = new GitClient(
                typeof remote === "string" ? remote : "origin",
                () => tokenStore.get(),
                () => {
                    const url = configStore.get("bitbucket.url");
                    return typeof url === "string" ? url : undefined;
                },
            );
        }

        return cachedGitClient;
    },
};

try {
    await runCli(process.argv.slice(2), context);
} catch (error) {
    if (error instanceof CommanderError) {
        process.exitCode = error.exitCode;
    } else {
        const message = error instanceof Error ? error.message : String(error);

        console.error(`Error: ${message}`);

        process.exitCode = 1;
    }
} finally {
    tokenStore.clearCache();
}
