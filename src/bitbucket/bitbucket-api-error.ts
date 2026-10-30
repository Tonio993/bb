export type BitbucketApiErrorOptions = {
    statusCode?: number;
    method?: string;
    path?: string;
};

export class BitbucketApiError extends Error {
    readonly statusCode: number | undefined;
    readonly method: string | undefined;
    readonly path: string | undefined;

    constructor(message: string, options: BitbucketApiErrorOptions = {}) {
        super(message);

        this.name = "BitbucketApiError";

        this.statusCode = options.statusCode;

        this.method = options.method;

        this.path = options.path;
    }
}
