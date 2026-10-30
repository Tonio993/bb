import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type TokenStoreOptions = {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
};

const service = "bb.bitbucket";
const account = "token";

export function normalizeToken(value: string): string {
    const token = value.trim();
    if (!token) throw new Error("Bitbucket token cannot be empty.");
    if (/[\s\p{Cc}]/u.test(token)) {
        throw new Error("Bitbucket token must not contain whitespace or control characters.");
    }
    if (Buffer.byteLength(token, "utf8") > 1024) {
        throw new Error("Bitbucket token must not exceed 1024 bytes.");
    }
    return token;
}

export class TokenStore {
    private readonly platform: NodeJS.Platform;
    private readonly environment: NodeJS.ProcessEnv;
    private readonly windowsPath: string;
    private cachedToken: string | undefined;

    constructor(options: TokenStoreOptions = {}) {
        this.platform = options.platform ?? process.platform;
        this.environment = options.environment ?? process.env;
        this.windowsPath = join(
            this.environment.APPDATA || join(options.homeDirectory ?? homedir(), "AppData", "Roaming"),
            "bb", "token.dat",
        );
    }

    get backend(): string {
        switch (this.platform) {
            case "win32": return "Windows DPAPI";
            case "darwin": return "macOS Keychain";
            case "linux": return "Linux Secret Service";
            default: throw new Error("Secure token storage is unavailable on this platform. Set BB_TOKEN instead.");
        }
    }

    get(): string {
        if (this.environment.BB_TOKEN !== undefined) return normalizeToken(this.environment.BB_TOKEN);
        if (this.cachedToken) return this.cachedToken;
        const token = this.readStoredToken();
        if (!token) throw new Error("Bitbucket token is not configured. Run 'bb token set' or set BB_TOKEN.");
        this.cachedToken = normalizeToken(token);
        return this.cachedToken;
    }

    source(): string | undefined {
        if (this.environment.BB_TOKEN !== undefined) {
            normalizeToken(this.environment.BB_TOKEN);
            return "BB_TOKEN";
        }
        const token = this.readStoredToken();
        if (!token) return undefined;
        normalizeToken(token);
        return this.backend;
    }

    set(value: string): void {
        const token = normalizeToken(value);
        this.clearCache();
        switch (this.platform) {
            case "win32":
                mkdirSync(dirname(this.windowsPath), { recursive: true });
                this.run(["-NoProfile", "-NonInteractive", "-Command", encryptTokenScript], token);
                break;
            case "darwin": {
                // security's interactive parser reads this command from stdin, not argv.
                const escaped = token.replace(/["\\]/g, "\\$&");
                this.run(["-i"], `add-generic-password -U -s ${service} -a ${account} -w "${escaped}"\n`);
                break;
            }
            case "linux":
                this.run(["store", "--label=bb Bitbucket token", "service", service, "account", account], token);
                break;
            default: throw new Error("Secure token storage is unavailable on this platform. Set BB_TOKEN instead.");
        }
    }

    delete(): void {
        this.clearCache();
        switch (this.platform) {
            case "win32": rmSync(this.windowsPath, { force: true }); break;
            case "darwin": this.run(["delete-generic-password", "-s", service, "-a", account], undefined, true); break;
            case "linux": this.run(["clear", "service", service, "account", account], undefined, true); break;
            default: throw new Error("Secure token storage is unavailable on this platform. Set BB_TOKEN instead.");
        }
    }

    clearCache(): void { this.cachedToken = undefined; }

    private readStoredToken(): string | undefined {
        let result;
        switch (this.platform) {
            case "win32":
                if (!existsSync(this.windowsPath)) return undefined;
                result = this.run(["-NoProfile", "-NonInteractive", "-Command", decryptTokenScript]);
                break;
            case "darwin":
                result = this.run(["find-generic-password", "-s", service, "-a", account, "-w"], undefined, true);
                break;
            case "linux":
                result = this.run(["lookup", "service", service, "account", account], undefined, true);
                break;
            default: throw new Error("Secure token storage is unavailable on this platform. Set BB_TOKEN instead.");
        }
        return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    }

    private run(args: string[], input?: string, allowMissing = false) {
        const command = this.platform === "win32" ? "powershell.exe"
            : this.platform === "darwin" ? "/usr/bin/security" : "secret-tool";
        const environment = { ...this.environment };
        delete environment.BB_TOKEN;
        if (this.platform === "win32") environment.BB_TOKEN_PATH = this.windowsPath;
        const result = spawnSync(command, args, {
            encoding: "utf8", shell: false, windowsHide: true,
            input, env: environment, timeout: 60000, maxBuffer: 65536,
        });
        const missing = allowMissing && !result.error && (
            (this.platform === "darwin" && result.status === 44) ||
            (this.platform === "linux" && result.status === 1 && !result.stderr.trim())
        );
        if (result.error || (result.status !== 0 && !missing)) {
            const hint = this.platform === "linux"
                ? "Install secret-tool (libsecret) and unlock a Secret Service session."
                : this.platform === "darwin" ? "Unlock the login keychain and allow access."
                    : "Ensure powershell.exe is available and use the Windows account that owns the token.";
            // Native tools may include the secret in their diagnostics; never forward them.
            throw new Error(`${this.backend} token operation failed. ${hint} Alternatively, set BB_TOKEN.`);
        }
        return result;
    }
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
