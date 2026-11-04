import type { TokenBackend } from "../token-backend.ts";
import { commandRunner, service, account } from "./token-command.ts";
import type { TokenCommandRunner } from "./token-command.ts";

export function createMacOsBackend(
    environment: NodeJS.ProcessEnv,
    execute: TokenCommandRunner,
): TokenBackend {
    const name = "macOS Keychain";
    const tool = "/usr/bin/security";
    const hint = "Unlock the login keychain and allow access.";
    const run = commandRunner({
        name,
        command: tool,
        environment,
        execute,
        hint,
        isMissing: (result) => result.status === 44,
    });
    return {
        name,
        tool,
        hint,
        read() {
            return run(
                ["find-generic-password", "-s", service, "-a", account, "-w"],
                undefined,
                true,
            );
        },
        write(token) {
            // security's interactive parser reads this command from stdin, not argv.
            const escaped = token.replace(/["\\]/g, "\\$&");
            run(["-i"], `add-generic-password -U -s ${service} -a ${account} -w "${escaped}"\n`);
        },
        delete() {
            run(["delete-generic-password", "-s", service, "-a", account], undefined, true);
        },
    };
}
