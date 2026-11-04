import type { Command } from "commander";

import type { CommandContext } from "../command-context.ts";
import { registerConfigCommand } from "./config-command.ts";
import { registerCreatePrCommand } from "./create-pr-command.ts";
import { registerGetPrUrlCommand } from "./get-pr-url-command.ts";
import { registerGetPrUrlsCommand } from "./get-pr-urls-command.ts";
import { registerGitCommand } from "./git-command.ts";
import { registerMergePrCommand } from "./merge-pr-command.ts";
import { registerTokenCommand } from "./token-command.ts";
import { registerDoctorCommand } from "./doctor-command.ts";

type CommandRegistrar = (program: Command, context: CommandContext) => void;

const commandRegistrars: CommandRegistrar[] = [
    registerDoctorCommand,
    registerConfigCommand,
    registerTokenCommand,
    registerGitCommand,
    registerGetPrUrlsCommand,
    registerGetPrUrlCommand,
    registerCreatePrCommand,
    registerMergePrCommand,
];

export function registerCommands(program: Command, context: CommandContext): void {
    for (const registerCommand of commandRegistrars) {
        registerCommand(program, context);
    }
}
