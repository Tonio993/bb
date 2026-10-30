import type { TokenBackend } from "./token-backend.ts";

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
    private readonly storage: TokenBackend;
    private readonly environment: NodeJS.ProcessEnv;
    private cachedToken: string | undefined;

    constructor(storage: TokenBackend, environment: NodeJS.ProcessEnv = process.env) {
        this.storage = storage;
        this.environment = environment;
    }

    get backend(): string {
        return this.storage.name;
    }

    get(): string {
        if (this.environment.BB_TOKEN !== undefined)
            return normalizeToken(this.environment.BB_TOKEN);
        if (this.cachedToken) return this.cachedToken;
        const token = this.storage.read();
        if (!token)
            throw new Error(
                "Bitbucket token is not configured. Run 'bb token set' or set BB_TOKEN.",
            );
        this.cachedToken = normalizeToken(token);
        return this.cachedToken;
    }

    source(): string | undefined {
        if (this.environment.BB_TOKEN !== undefined) {
            normalizeToken(this.environment.BB_TOKEN);
            return "BB_TOKEN";
        }
        const token = this.storage.read();
        if (!token) return undefined;
        normalizeToken(token);
        return this.backend;
    }

    set(value: string): void {
        const token = normalizeToken(value);
        this.clearCache();
        this.storage.write(token);
    }

    delete(): void {
        this.clearCache();
        this.storage.delete();
    }

    clearCache(): void {
        this.cachedToken = undefined;
    }
}
