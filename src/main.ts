import {
    CommanderError,
} from "commander";

import {
    BitbucketClient,
} from "./bitbucket/bitbucket-client.ts";

import {
    clearBitbucketTokenCache,
} from "./auth/token-store.ts";

import {
    runCli,
} from "./cli/cli.ts";

import type {
    CommandContext,
} from "./cli/command-context.ts";

import {
    ConfigStore,
} from "./config/config.ts";

import {
    GitClient,
} from "./git/git-client.ts";


const configStore =
    new ConfigStore();


let cachedConfig:
    ReturnType<ConfigStore["loadRequired"]> | undefined;


let cachedBitbucketClient: BitbucketClient | undefined;


let cachedGitClient: GitClient | undefined;


const getConfig = () => {
    cachedConfig ??=
        configStore.loadRequired();

    return cachedConfig;
};


const context: CommandContext = {
    configStore,

    get config() {
        return getConfig();
    },

    get bitbucketClient() {
        cachedBitbucketClient ??=
            new BitbucketClient(
                getConfig().bitbucket,
            );

        return cachedBitbucketClient;
    },

    get gitClient() {
        if (!cachedGitClient) {
            const remote =
                configStore.get("git.remote");

            cachedGitClient = new GitClient(
                typeof remote === "string"
                    ? remote
                    : "origin",
            );
        }

        return cachedGitClient;
    },
};


try {
    await runCli(
        process.argv.slice(2),
        context,
    );
} catch (error) {
    if (error instanceof CommanderError) {
        process.exitCode = error.exitCode;
    } else {
        const message =
            error instanceof Error
                ? error.message
                : String(error);

        console.error(
            `Error: ${message}`,
        );

        process.exitCode = 1;
    }
} finally {
    clearBitbucketTokenCache();
}
