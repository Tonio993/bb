import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TokenBackend } from "./token-backend.ts";

type TokenCommandResult = Pick<SpawnSyncReturns<string>, "status" | "stdout" | "stderr" | "signal" | "error">;
export type TokenCommandRunner = (
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
) => TokenCommandResult;

type TokenBackendOptions = {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
    execute?: TokenCommandRunner;
};

type TokenCommandSettings = {
    name: string;
    command: string;
    hint: string;
    environment: NodeJS.ProcessEnv;
    execute: TokenCommandRunner;
    isMissing?: (result: TokenCommandResult) => boolean;
    extraEnvironment?: NodeJS.ProcessEnv;
};

const service = "bb.bitbucket";
const account = "token";

export function createTokenBackend(options: TokenBackendOptions = {}): TokenBackend {
    const environment = options.environment ?? process.env;
    const execute: TokenCommandRunner = options.execute ?? ((command, args, settings) => spawnSync(command, args, settings));
    switch (options.platform ?? process.platform) {
        case "win32": return createWindowsBackend(environment, options.homeDirectory ?? homedir(), execute);
        case "darwin": return createMacOsBackend(environment, execute);
        case "linux": return createLinuxBackend(environment, execute);
        default: return {
            get name(): never { return unavailable(); },
            read: unavailable,
            write: unavailable,
            delete: unavailable,
        };
    }
}

function unavailable(): never {
    throw new Error("Secure token storage is unavailable on this platform. Set BB_TOKEN instead.");
}

function commandRunner({
    name, command, hint, environment, execute,
    isMissing = () => false, extraEnvironment = {},
}: TokenCommandSettings) {
    return (args: string[], input?: string, allowMissing = false): string | undefined => {
        const childEnvironment = { ...environment, ...extraEnvironment };
        delete childEnvironment.BB_TOKEN;
        const failure = () => new Error(`${name} token operation failed. ${hint} Alternatively, set BB_TOKEN.`);
        let result: TokenCommandResult;
        try {
            result = execute(command, args, {
                encoding: "utf8", shell: false, windowsHide: true,
                input, env: childEnvironment, timeout: 60000, maxBuffer: 65536,
            });
        } catch {
            // Native tools may include the secret in their diagnostics; never forward them.
            throw failure();
        }
        if (result.error || result.signal || (result.status !== 0 && !(allowMissing && isMissing(result)))) {
            throw failure();
        }
        return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    };
}

function createWindowsBackend(environment: NodeJS.ProcessEnv, homeDirectory: string, execute: TokenCommandRunner): TokenBackend {
    const name = "Windows DPAPI";
    const path = join(environment.APPDATA || join(homeDirectory, "AppData", "Roaming"), "bb", "token.dat");
    const run = commandRunner({
        name, command: "powershell.exe", environment, execute,
        hint: "Ensure powershell.exe is available and use the Windows account that owns the token.",
        extraEnvironment: { BB_TOKEN_PATH: path },
    });
    return {
        name,
        read() {
            if (!existsSync(path)) return undefined;
            return run(["-NoProfile", "-NonInteractive", "-Command", decryptTokenScript]);
        },
        write(token) {
            mkdirSync(dirname(path), { recursive: true });
            run(["-NoProfile", "-NonInteractive", "-Command", encryptTokenScript], token);
        },
        delete() { rmSync(path, { force: true }); },
    };
}

function createMacOsBackend(environment: NodeJS.ProcessEnv, execute: TokenCommandRunner): TokenBackend {
    const name = "macOS Keychain";
    const run = commandRunner({
        name, command: "/usr/bin/security", environment, execute,
        hint: "Unlock the login keychain and allow access.",
        isMissing: (result) => result.status === 44,
    });
    return {
        name,
        read() { return run(["find-generic-password", "-s", service, "-a", account, "-w"], undefined, true); },
        write(token) {
            // security's interactive parser reads this command from stdin, not argv.
            const escaped = token.replace(/["\\]/g, "\\$&");
            run(["-i"], `add-generic-password -U -s ${service} -a ${account} -w "${escaped}"\n`);
        },
        delete() { run(["delete-generic-password", "-s", service, "-a", account], undefined, true); },
    };
}

function createLinuxBackend(environment: NodeJS.ProcessEnv, execute: TokenCommandRunner): TokenBackend {
    const name = "Linux Secret Service";
    const run = commandRunner({
        name, command: "secret-tool", environment, execute,
        hint: "Install secret-tool (libsecret) and unlock a Secret Service session.",
        isMissing: (result) => result.status === 1 && !result.stderr.trim(),
    });
    return {
        name,
        read() { return run(["lookup", "service", service, "account", account], undefined, true); },
        write(token) { run(["store", "--label=bb Bitbucket token", "service", service, "account", account], token); },
        delete() { run(["clear", "service", service, "account", account], undefined, true); },
    };
}

const decryptTokenScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$SecureToken = (Get-Content -LiteralPath $env:BB_TOKEN_PATH -Raw).Trim() | ConvertTo-SecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr))
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}
`;

const encryptTokenScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$Token = [Console]::In.ReadToEnd()
$SecureToken = ConvertTo-SecureString -String $Token -AsPlainText -Force
$EncryptedToken = ConvertFrom-SecureString -SecureString $SecureToken
[System.IO.File]::WriteAllText($env:BB_TOKEN_PATH, $EncryptedToken, [System.Text.UTF8Encoding]::new($false))
`;
