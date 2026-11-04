export type BitbucketApiErrorOptions = {
    kind?: "http" | "timeout" | "connection" | "response";
    statusCode?: number;
    method?: string;
    path?: string;
};

export class BitbucketApiError extends Error {
    readonly kind: BitbucketApiErrorOptions["kind"];
    readonly statusCode: number | undefined;
    readonly method: string | undefined;
    readonly path: string | undefined;

    constructor(message: string, options: BitbucketApiErrorOptions = {}) {
        super(message);

        this.name = "BitbucketApiError";
        this.kind = options.kind;

        this.statusCode = options.statusCode;

        this.method = options.method;

        this.path = options.path;
    }
}
