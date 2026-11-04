import type { TokenBackend } from "../token-backend.ts";
import { commandRunner, service, account } from "./token-command.ts";
import type { TokenCommandRunner } from "./token-command.ts";

export function createLinuxBackend(
    environment: NodeJS.ProcessEnv,
    execute: TokenCommandRunner,
): TokenBackend {
    const name = "Linux Secret Service";
    const tool = "secret-tool";
    const hint = "Install secret-tool (libsecret) and unlock a Secret Service session.";
    const run = commandRunner({
        name,
        command: tool,
        environment,
        execute,
        hint,
        isMissing: (result) => result.status === 1 && !result.stderr.trim(),
    });
    return {
        name,
        tool,
        hint,
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
