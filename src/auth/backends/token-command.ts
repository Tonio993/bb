import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";

type TokenCommandResult = Pick<
    SpawnSyncReturns<string>,
    "status" | "stdout" | "stderr" | "signal" | "error"
>;

export type TokenCommandRunner = (
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
) => TokenCommandResult;

type TokenCommandSettings = {
    name: string;
    command: string;
    hint: string;
    environment: NodeJS.ProcessEnv;
    execute: TokenCommandRunner;
    isMissing?: (result: TokenCommandResult) => boolean;
    extraEnvironment?: NodeJS.ProcessEnv;
};

export const service = "bb.bitbucket";

export const account = "token";

export function commandRunner({
    name,
    command,
    hint,
    environment,
    execute,
    isMissing = () => false,
    extraEnvironment = {},
}: TokenCommandSettings) {
    return (args: string[], input?: string, allowMissing = false): string | undefined => {
        const childEnvironment = { ...environment, ...extraEnvironment };
        delete childEnvironment.BB_TOKEN;
        const failure = () =>
            new Error(`${name} token operation failed. ${hint} Alternatively, set BB_TOKEN.`);
        let result: TokenCommandResult;
        try {
            result = execute(command, args, {
                encoding: "utf8",
                shell: false,
                windowsHide: true,
                input,
                env: childEnvironment,
                timeout: 60000,
                maxBuffer: 65536,
            });
        } catch {
            // Native tools may include the secret in their diagnostics; never forward them.
            throw failure();
        }
        if (
            result.error ||
            result.signal ||
            (result.status !== 0 && !(allowMissing && isMissing(result)))
        ) {
            throw failure();
        }
        return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    };
}
