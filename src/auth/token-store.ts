import {
    spawnSync,
} from "node:child_process";

import {
    existsSync,
} from "node:fs";

import {
    join,
} from "node:path";

let cachedToken: string | undefined;

export function getBitbucketToken(): string {
    if (cachedToken) {
        return cachedToken;
    }

    if (process.platform !== "win32") {
        throw new Error(
            "The current token store is only supported on Windows.",
        );
    }

    const appData =
        process.env.APPDATA;

    if (!appData) {
        throw new Error(
            "APPDATA environment variable is not available.",
        );
    }

    const tokenPath =
        join(
            appData,
            "bb",
            "token.dat",
        );

    if (!existsSync(tokenPath)) {
        throw new Error(
            `Bitbucket token not configured: ${tokenPath}`,
        );
    }

    const result = spawnSync(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            decryptTokenScript,
        ],
        {
            encoding: "utf8",
            windowsHide: true,

            env: {
                ...process.env,
                BB_TOKEN_PATH: tokenPath,
            },
        },
    );

    if (result.error) {
        throw new Error(
            `Unable to decrypt the Bitbucket token: ${result.error.message}`,
        );
    }

    if (result.status !== 0) {
        const message =
            result.stderr.trim() ||
            "PowerShell returned an error.";

        throw new Error(
            `Unable to decrypt the Bitbucket token: ${message}`,
        );
    }

    const token =
        result.stdout.trim();

    if (!token) {
        throw new Error(
            "Bitbucket token is empty.",
        );
    }

    cachedToken = token;

    return token;
}

export function clearBitbucketTokenCache(): void {
    cachedToken = undefined;
}

const decryptTokenScript = `
$EncryptedToken = (Get-Content $env:BB_TOKEN_PATH -Raw).Trim()

$SecureToken = $EncryptedToken |
    ConvertTo-SecureString

$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
    $SecureToken
)

try {
    [Console]::Out.Write(
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    )
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}
`;
