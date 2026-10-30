import { Command, CommanderError } from "commander";

import type { CommandContext } from "./command-context.ts";
import { registerCommands } from "./commands/index.ts";

export async function runCli(args: string[], context: CommandContext): Promise<void> {
    const program = new Command();

    let originalDirectory: string | undefined;

    let workingDirectoryChanged = false;

    program
        .name("bb")
        .exitOverride()
        .description("Bitbucket command-line helper.")
        .option("-C, --path <path>", "Run the command from the specified directory")
        .enablePositionalOptions()
        .showHelpAfterError("(run with --help for additional information)");

    registerCommands(program, context);

    program.hook("preAction", (_command, actionCommand) => {
        const options = actionCommand.optsWithGlobals() as {
            path?: string;
        };

        if (options.path === undefined) {
            return;
        }

        originalDirectory = process.cwd();

        try {
            process.chdir(options.path);

            workingDirectoryChanged = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            throw new Error(`Unable to use directory '${options.path}': ${message}`);
        }
    });

    try {
        await program.parseAsync(args, {
            from: "user",
        });
    } catch (error) {
        if (!(error instanceof CommanderError) || error.exitCode !== 0) {
            throw error;
        }
    } finally {
        if (workingDirectoryChanged && originalDirectory) {
            process.chdir(originalDirectory);
        }
    }
}
