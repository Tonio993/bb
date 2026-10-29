import type {
    Command,
} from "commander";

import type {
    CommandContext,
} from "../cli/command-context.ts";

export function registerGitCommand(
    program: Command,
    context: CommandContext,
): void {
    program
        .command("git")
        .description(
            "Execute a Git command with Bitbucket authentication.",
        )
        .argument(
            "[args...]",
            "Arguments passed directly to Git",
        )
        .allowUnknownOption()
        .passThroughOptions()
        .addHelpText(
            "after",
            `
Examples:
  bb git status
  bb git fetch origin
  bb git log --oneline -10
  bb git -C C:\\repository status
`,
        )
        .action(
            (args: string[]) => {
                if (args.length === 0) {
                    throw new Error(
                        "A Git command is required.",
                    );
                }

                const exitCode =
                    context.gitClient.run(
                        args,
                        {
                            authenticated: true,
                        },
                    );

                if (exitCode !== 0) {
                    process.exitCode =
                        exitCode;
                }
            },
        );
}
