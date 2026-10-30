import type { Command } from "commander";
import { CommanderError } from "commander";
import type { CommandContext } from "../cli/command-context.ts";
import { readTokenInput } from "../auth/token-input.ts";

export function registerTokenCommand(program: Command, context: CommandContext): void {
    const showStatus = () => {
        const source = context.tokenStore.source();
        console.log(source ? `Bitbucket token source: ${source}` : "Bitbucket token is not configured. Run 'bb token set' or set BB_TOKEN.");
        if (!source) process.exitCode = 1;
    };
    const parseError = "Invalid token command arguments. Use 'bb token --help' for usage.";
    const command = program.command("token")
        .description("Manage the Bitbucket token in the operating system's secure storage.")
        .configureOutput({ outputError: (_message, write) => write(`error: ${parseError}\n`) })
        .exitOverride((error) => {
            // Commander may include rejected argument values in its error message.
            if (error.exitCode !== 0) throw new CommanderError(error.exitCode, error.code, parseError);
            throw error;
        })
        .action(showStatus);
    command.command("status")
        .description("Show the token source without displaying its value.")
        .action(showStatus);
    command.command("set")
        .description("Save a token using hidden interactive input or stdin.")
        .option("--stdin", "Read the token from standard input instead of prompting")
        .action(async (options: { stdin?: boolean }) => {
            context.tokenStore.set(await readTokenInput(options.stdin === true));
            console.log("Bitbucket token saved.");
        });
    command.command("delete")
        .description("Delete the stored token; BB_TOKEN is not modified.")
        .action(() => {
            context.tokenStore.delete();
            console.log("Stored Bitbucket token deleted.");
        });
}
