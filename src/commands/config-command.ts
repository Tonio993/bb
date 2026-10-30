import type {
    Command,
} from "commander";

import {
    createInterface,
} from "node:readline/promises";

import {
    stdin,
    stdout,
} from "node:process";

import type {
    CommandContext,
} from "../cli/command-context.ts";

import {
    CONFIG_KEYS,
    isConfigKey,
} from "../config/config.ts";


export function registerConfigCommand(
    program: Command,
    context: CommandContext,
): void {
    const command = program
        .command("config")
        .description(
            "View and modify the global bb configuration.",
        )
        .argument(
            "[key]",
            "Configuration key",
        )
        .argument(
            "[value]",
            "New configuration value",
        )
        .addHelpText(
            "after",
            `
Examples:
  bb config
  bb config list
  bb config init

  bb config bitbucket.url
  bb config bitbucket.url "https://bitbucket.company.com"
  bb config bitbucket.projectKey "PROJECT"
  bb config bitbucket.defaultReviewers "mrossi,lbianchi"
  bb config git.remote "origin"
`,
        )
        .action(
            async (
                key: string | undefined,
                value: string | undefined,
            ) => {
                if (!key) {
                    showConfiguration(
                        context,
                    );

                    return;
                }

                if (!isConfigKey(key)) {
                    throw new Error(
                        `Unknown configuration key '${key}'.\n\n` +
                        `Available keys:\n` +
                        CONFIG_KEYS
                            .map(
                                (configKey) =>
                                    `  ${configKey}`,
                            )
                            .join("\n"),
                    );
                }

                if (value === undefined) {
                    showConfigurationValue(
                        context,
                        key,
                    );

                    return;
                }

                context.configStore.set(
                    key,
                    value,
                );

                console.log(
                    `${key} = ${formatValue(
                        context.configStore.get(
                            key,
                        ),
                    )}`,
                );
            },
        );

    command
        .command("list")
        .description("List the global bb configuration.")
        .action(() => showConfiguration(context));

    command
        .command("init")
        .description("Configure global bb settings interactively.")
        .action(async () => initializeConfiguration(context));
}


function showConfiguration(
    context: CommandContext,
): void {
    const config = context.configStore.snapshot();
    console.log(
        `Configuration file: ${context.configStore.path}`,
    );

    console.log();

    for (const key of CONFIG_KEYS) {
        console.log(
            `${key} = ${formatValue(
                config[key],
            )}`,
        );
    }
}


function showConfigurationValue(
    context: CommandContext,
    key: typeof CONFIG_KEYS[number],
): void {
    const value =
        context.configStore.get(
            key,
        );

    if (value === undefined) {
        return;
    }

    console.log(
        formatValue(value),
    );
}


async function initializeConfiguration(
    context: CommandContext,
): Promise<void> {
    const config = context.configStore.snapshot();
    const readline =
        createInterface({
            input: stdin,
            output: stdout,
        });

    try {
        console.log(
            `Initializing bb configuration:`,
        );

        console.log(
            context.configStore.path,
        );

        console.log();


        const bitbucketUrl =
            await askRequired(
                readline,
                "Bitbucket URL",
                config["bitbucket.url"],
            );


        const projectKey =
            await askRequired(
                readline,
                "Bitbucket project key",
                config["bitbucket.projectKey"],
            );


        const currentReviewers =
            config["bitbucket.defaultReviewers"];

        const reviewersInput =
            await readline.question(
                buildPrompt(
                    "Default reviewers (comma separated)",
                    currentReviewers.join(","),
                ),
            );

        const defaultReviewers =
            reviewersInput.trim()
                ? reviewersInput
                    .split(",")
                : currentReviewers;


        const currentRemote =
            config["git.remote"];

        const remoteInput =
            await readline.question(
                buildPrompt(
                    "Git remote",
                    currentRemote,
                ),
            );

        const remote =
            remoteInput.trim()
            || currentRemote;


        context.configStore.save({
            bitbucket: {
                url:
                    bitbucketUrl,

                projectKey,

                defaultReviewers,
            },

            git: {
                remote,
            },
        });


        console.log();
        console.log(
            "Configuration saved successfully.",
        );
    } finally {
        readline.close();
    }
}


async function askRequired(
    readline: ReturnType<
        typeof createInterface
    >,
    label: string,
    currentValue?: string,
): Promise<string> {
    while (true) {
        const value =
            await readline.question(
                buildPrompt(
                    label,
                    currentValue,
                ),
            );

        const resolved =
            value.trim()
            || currentValue;

        if (resolved) {
            return resolved;
        }

        console.log(
            `${label} is required.`,
        );
    }
}


function buildPrompt(
    label: string,
    currentValue?: string,
): string {
    if (currentValue) {
        return `${label} [${currentValue}]: `;
    }

    return `${label}: `;
}


function formatValue(
    value: string | string[] | undefined,
): string {
    if (Array.isArray(value)) {
        return value.join(",");
    }

    return value ?? "<not configured>";
}
