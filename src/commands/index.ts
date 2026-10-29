import type {
    Command,
} from "commander";

import type {
    CommandContext,
} from "../cli/command-context.ts";

import {
    registerConfigCommand,
} from "./config-command.ts";

import {
    registerGetPrUrlCommand,
} from "./get-pr-url-command.ts";

import {
    registerGetPrUrlsCommand,
} from "./get-pr-urls-command.ts";

import {
    registerGitCommand,
} from "./git-command.ts";

import {
    registerCreatePrCommand,
} from "./create-pr-command.ts";


type CommandRegistrar = (
    program: Command,
    context: CommandContext,
) => void;


const commandRegistrars: CommandRegistrar[] = [
    registerConfigCommand,
    registerGitCommand,
    registerGetPrUrlsCommand,
    registerGetPrUrlCommand,
    registerCreatePrCommand,
];


export function registerCommands(
    program: Command,
    context: CommandContext,
): void {
    for (const registerCommand of commandRegistrars) {
        registerCommand(
            program,
            context,
        );
    }
}
