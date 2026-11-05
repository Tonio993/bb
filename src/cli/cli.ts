import { Command, CommanderError } from "commander";

import type { CommandContext } from "./command-context.ts";
import { registerCommands } from "./commands/index.ts";
import { usesJsonOutput, commandName, writeJsonResult } from "./json-output.ts";
import { toJsonError } from "./json-errors.ts";

export async function runCli(args: string[], context: CommandContext): Promise<void> {
    const program = new Command();
    let activeCommand: Command | undefined;
    const jsonCommand = (command: Command): Command | undefined => {
        if (command.getOptionValue("json") === true) return command;
        for (const child of command.commands) {
            const selected = jsonCommand(child);
            if (selected) return selected;
        }
        return undefined;
    };
    const jsonEnabled = () => jsonCommand(program) !== undefined;

    let originalDirectory: string | undefined;

    let workingDirectoryChanged = false;

    program
        .name("bb")
        .exitOverride()
        .description("Bitbucket command-line helper.")
        .option("-C, --path <path>", "Run the command from the specified directory")
        .option("--json", "Output a versioned JSON result for supported commands")
        .enablePositionalOptions()
        .showHelpAfterError("(run with --help for additional information)");

    const writeErr =
        program.configureOutput().writeErr ?? ((message: string) => process.stderr.write(message));
    program.configureOutput({
        writeErr: (message) => {
            if (!jsonEnabled()) writeErr(message);
        },
    });
    registerCommands(program, context);

    program.hook("preAction", (_command, actionCommand) => {
        activeCommand = actionCommand;
        if (
            usesJsonOutput(actionCommand) &&
            !actionCommand.options.some((option) => option.long === "--json")
        ) {
            throw new CommanderError(
                1,
                "bb.jsonUnsupported",
                "JSON output is not supported for this command.",
            );
        }
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
        if (error instanceof CommanderError && error.exitCode === 0) return;
        if (!jsonEnabled()) throw error;
        writeJsonResult(
            commandName(activeCommand ?? jsonCommand(program) ?? program),
            null,
            toJsonError(error),
        );
    } finally {
        if (workingDirectoryChanged && originalDirectory) {
            process.chdir(originalDirectory);
        }
    }
}
