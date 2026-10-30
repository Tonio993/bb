import type { TokenBackend } from "../token-backend.ts";
import { commandRunner, service, account } from "./token-command.ts";
import type { TokenCommandRunner } from "./token-command.ts";

export function createLinuxBackend(
    environment: NodeJS.ProcessEnv,
    execute: TokenCommandRunner,
): TokenBackend {
    const name = "Linux Secret Service";
    const run = commandRunner({
        name,
        command: "secret-tool",
        environment,
        execute,
        hint: "Install secret-tool (libsecret) and unlock a Secret Service session.",
        isMissing: (result) => result.status === 1 && !result.stderr.trim(),
    });
    return {
        name,
        read() {
            return run(["lookup", "service", service, "account", account], undefined, true);
        },
        write(token) {
            run(
                ["store", "--label=bb Bitbucket token", "service", service, "account", account],
                token,
            );
        },
        delete() {
            run(["clear", "service", service, "account", account], undefined, true);
        },
    };
}
