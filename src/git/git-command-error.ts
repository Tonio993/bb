export type GitCommandErrorOptions = {
    exitCode?: number;
    args?: readonly string[];
};


export class GitCommandError extends Error {
    readonly exitCode: number | undefined;
    readonly args: readonly string[];


    constructor(
        message: string,
        options: GitCommandErrorOptions = {},
    ) {
        super(message);

        this.name = "GitCommandError";

        this.exitCode =
            options.exitCode;

        this.args = [
            ...(options.args ?? []),
        ];
    }
}
