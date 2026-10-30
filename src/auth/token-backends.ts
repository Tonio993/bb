import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { createLinuxBackend } from "./backends/linux-secret-service.ts";
import { createMacOsBackend } from "./backends/macos-keychain.ts";
import type { TokenCommandRunner } from "./backends/token-command.ts";
import { createWindowsBackend } from "./backends/windows-dpapi.ts";
import type { TokenBackend } from "./token-backend.ts";

type TokenBackendOptions = {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
    execute?: TokenCommandRunner;
};

export function createTokenBackend(options: TokenBackendOptions = {}): TokenBackend {
    const environment = options.environment ?? process.env;
    const execute: TokenCommandRunner =
        options.execute ?? ((command, args, settings) => spawnSync(command, args, settings));
    switch (options.platform ?? process.platform) {
        case "win32":
            return createWindowsBackend(environment, options.homeDirectory ?? homedir(), execute);
        case "darwin":
            return createMacOsBackend(environment, execute);
        case "linux":
            return createLinuxBackend(environment, execute);
        default:
            return {
                get name(): never {
                    return unavailable();
                },
                read: unavailable,
                write: unavailable,
                delete: unavailable,
            };
    }
}

function unavailable(): never {
    throw new Error("Secure token storage is unavailable on this platform. Set BB_TOKEN instead.");
}
