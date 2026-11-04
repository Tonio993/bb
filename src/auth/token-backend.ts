export type TokenBackend = {
    readonly name: string;
    readonly tool?: string;
    readonly hint?: string;
    read(): string | undefined;
    // TokenStore validates and normalizes the secret before passing it to storage.
    write(token: string): void;
    delete(): void;
};
