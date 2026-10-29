import {
    Command,
} from "commander";

import type {
    CommandContext,
} from "./command-context.ts";

import {
    registerCommands,
} from "../commands/index.ts";


export async function runCli(
    args: string[],
    context: CommandContext,
): Promise<void> {
    const program =
        new Command();

    let originalDirectory:
        string | undefined;

    let workingDirectoryChanged =
        false;


    program
        .name("bb")
        .description(
            "Bitbucket command-line helper.",
        )
        .option(
            "-C, --path <path>",
            "Run the command from the specified directory",
        )
        .enablePositionalOptions()
        .showHelpAfterError(
            "(run with --help for additional information)",
        );


    registerCommands(
        program,
        context,
    );


    program.hook(
        "preAction",
        (_command, actionCommand) => {
            const options =
                actionCommand.optsWithGlobals() as {
                    path?: string;
                };

            if (!options.path) {
                return;
            }

            originalDirectory =
                process.cwd();

            try {
                process.chdir(
                    options.path,
                );

                workingDirectoryChanged =
                    true;
            } catch {
                throw new Error(
                    `Directory '${options.path}' not found.`,
                );
            }
        },
    );


    try {
        await program.parseAsync(
            args,
            {
                from: "user",
            },
        );
    } finally {
        if (
            workingDirectoryChanged &&
            originalDirectory
        ) {
            process.chdir(
                originalDirectory,
            );
        }
    }
}
