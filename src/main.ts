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


const getConfig = () => {
    cachedConfig ??=
        configStore.loadRequired();

    return cachedConfig;
};


const gitRemote =
    configStore.get(
        "git.remote",
    );

const gitClient =
    new GitClient(
        typeof gitRemote === "string"
            ? gitRemote
            : "origin",
    );


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

    gitClient,
};


try {
    await runCli(
        process.argv.slice(2),
        context,
    );
} catch (error) {
    const message =
        error instanceof Error
            ? error.message
            : String(error);

    console.error(
        `Error: ${message}`,
    );

    process.exitCode = 1;
} finally {
    clearBitbucketTokenCache();
}
