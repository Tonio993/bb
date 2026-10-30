export type GitCommandErrorOptions = {
    exitCode?: number;
    args?: readonly string[];
    signal?: NodeJS.Signals;
};


export class GitCommandError extends Error {
    readonly exitCode: number | undefined;
    readonly args: readonly string[];
    readonly signal: NodeJS.Signals | undefined;


    constructor(
        message: string,
        options: GitCommandErrorOptions = {},
    ) {
        super(message);

        this.name = "GitCommandError";

        this.exitCode =
            options.exitCode;
        this.signal = options.signal;

        this.args = [
            ...(options.args ?? []),
        ];
    }
}
