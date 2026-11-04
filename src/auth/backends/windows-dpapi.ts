import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import type { TokenBackend } from "../token-backend.ts";
import { commandRunner } from "./token-command.ts";
import type { TokenCommandRunner } from "./token-command.ts";

export function createWindowsBackend(
    environment: NodeJS.ProcessEnv,
    homeDirectory: string,
    execute: TokenCommandRunner,
): TokenBackend {
    const name = "Windows DPAPI";
    const tool = "powershell.exe";
    const hint =
        "Ensure powershell.exe is available and use the Windows account that owns the token.";
    const path = join(
        environment.APPDATA || join(homeDirectory, "AppData", "Roaming"),
        "bb",
        "token.dat",
    );
    const run = commandRunner({
        name,
        command: tool,
        environment,
        execute: (command, args, options) => {
            // Windows PowerShell must not inherit incompatible PowerShell 7 module paths.
            const childEnvironment = { ...options.env };
            for (const key of Object.keys(childEnvironment)) {
                if (key.toUpperCase() === "PSMODULEPATH") delete childEnvironment[key];
            }
            return execute(command, args, { ...options, env: childEnvironment });
        },
        hint,
        extraEnvironment: { BB_TOKEN_PATH: path },
    });
    return {
        name,
        tool,
        hint,
        read() {
            if (!existsSync(path)) return undefined;
            return run(["-NoProfile", "-NonInteractive", "-Command", decryptTokenScript]);
        },
        write(token) {
            mkdirSync(dirname(path), { recursive: true });
            run(["-NoProfile", "-NonInteractive", "-Command", encryptTokenScript], token);
        },
        delete() {
            rmSync(path, { force: true });
        },
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
