import { BitbucketApiError } from "./bitbucket-api-error.ts";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

type TokenProvider = () => string;

export type ResponseParser<T> = (value: unknown) => T;
export type FetchImplementation = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>;
export type BitbucketApi = Pick<BitbucketClient, "get" | "post" | "put" | "delete">;

type BitbucketClientOptions = {
    redirect?: RequestRedirect;
    timeoutMs?: number;
    fetch?: FetchImplementation;
};

export class BitbucketClient {
    private readonly redirect: RequestRedirect | undefined;
    private readonly baseUrl: string;
    private readonly tokenProvider: TokenProvider;
    private readonly timeoutMs: number;
    private readonly fetch: FetchImplementation;

    constructor(
        baseUrl: string,
        tokenProvider: TokenProvider,
        options: BitbucketClientOptions = {},
    ) {
        this.redirect = options.redirect;
        this.timeoutMs = options.timeoutMs ?? 60000;
        if (
            !Number.isInteger(this.timeoutMs) ||
            this.timeoutMs <= 0 ||
            this.timeoutMs > 2147483647
        ) {
            throw new Error(
                "Bitbucket request timeout must be a positive integer no greater than 2147483647 milliseconds.",
            );
        }
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.tokenProvider = tokenProvider;
        this.fetch = options.fetch ?? globalThis.fetch;
    }

    get(path: string): Promise<unknown>;
    get<T>(path: string, parse: ResponseParser<T>): Promise<T>;
    get(path: string, parse?: ResponseParser<unknown>): Promise<unknown> {
        return this.request("GET", path, undefined, parse);
    }

    post(path: string, body?: unknown): Promise<unknown>;
    post<T>(path: string, body: unknown, parse: ResponseParser<T>): Promise<T>;
    post(path: string, body?: unknown, parse?: ResponseParser<unknown>): Promise<unknown> {
        return this.request("POST", path, body, parse);
    }

    put(path: string, body?: unknown): Promise<unknown>;
    put<T>(path: string, body: unknown, parse: ResponseParser<T>): Promise<T>;
    put(path: string, body?: unknown, parse?: ResponseParser<unknown>): Promise<unknown> {
        return this.request("PUT", path, body, parse);
    }

    delete<T>(path: string, parse: ResponseParser<T>): Promise<T>;
    delete(path: string, body?: unknown): Promise<unknown>;
    delete<T>(path: string, body: unknown, parse: ResponseParser<T>): Promise<T>;
    delete(path: string, bodyOrParse?: unknown, parse?: ResponseParser<unknown>): Promise<unknown> {
        if (typeof bodyOrParse === "function") {
            return this.request("DELETE", path, undefined, bodyOrParse as ResponseParser<unknown>);
        }
        return this.request("DELETE", path, bodyOrParse, parse);
    }

    private async request(
        method: HttpMethod,
        path: string,
        body?: unknown,
        parse?: ResponseParser<unknown>,
    ): Promise<unknown> {
        const token = this.tokenProvider();

        const url = this.buildUrl(path);

        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        };

        const request: RequestInit = {
            method,
            headers,
        };
        if (this.redirect !== undefined) request.redirect = this.redirect;

        if (body !== undefined) {
            headers["Content-Type"] = "application/json; charset=utf-8";

            request.body = JSON.stringify(body);
        }

        const controller = new AbortController();
        request.signal = controller.signal;
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response | undefined;

        try {
            response = await this.fetch(url, request);
            const responseBody = await readResponseBody(response);
            controller.signal.throwIfAborted();

            if (!response.ok) {
                const message = getBitbucketErrorMessage(responseBody, response.statusText);
                throw new BitbucketApiError(
                    `Bitbucket API request failed [${response.status}]: ${message}`,
                    { statusCode: response.status, method, path, kind: "http" },
                );
            }

            if (!parse) return responseBody;
            try {
                return parse(responseBody);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Unexpected response structure.";
                throw new BitbucketApiError(
                    `Invalid Bitbucket response [${response.status}]: ${message}`,
                    {
                        statusCode: response.status,
                        kind: "response",
                        method,
                        path,
                    },
                );
            }
        } catch (error) {
            if (error instanceof BitbucketApiError) throw error;
            const detail = error instanceof Error ? error.message : String(error);
            const message = controller.signal.aborted
                ? `Bitbucket request timed out after ${this.timeoutMs} ms. Check the server state before retrying a write operation.`
                : response
                  ? `Unable to read Bitbucket response [${response.status}]: ${detail}`
                  : `Unable to connect to Bitbucket: ${detail}`;
            throw new BitbucketApiError(message, {
                statusCode: response?.status,
                method,
                path,
                kind: controller.signal.aborted ? "timeout" : response ? "response" : "connection",
            });
        } finally {
            clearTimeout(timer);
        }
    }

    private buildUrl(path: string): string {
        const normalizedPath = path.replace(/^\/+/, "");

        return `${this.baseUrl}/${normalizedPath}`;
    }
}

async function readResponseBody(response: Response): Promise<unknown> {
    const content = await response.text();

    if (!content.trim()) {
        return undefined;
    }

    try {
        return JSON.parse(content);
    } catch {
        if (response.ok) {
            throw new Error("Expected a JSON response from Bitbucket.");
        }
        return content;
    }
}

function getBitbucketErrorMessage(body: unknown, fallback: string): string {
    if (typeof body === "string") {
        const message = body.trim();

        if (message) {
            return message;
        }
    }

    if (typeof body === "object" && body !== null) {
        const value = body as Record<string, unknown>;

        if (Array.isArray(value.errors)) {
            const messages = value.errors
                .map(getErrorEntryMessage)
                .filter((message): message is string => Boolean(message));

            if (messages.length > 0) {
                return messages.join("; ");
            }
        }

        if (typeof value.message === "string" && value.message.trim()) {
            return value.message.trim();
        }
    }

    return fallback || "Unknown Bitbucket error.";
}

function getErrorEntryMessage(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) {
        return undefined;
    }

    const value = error as Record<string, unknown>;

    if (typeof value.message === "string" && value.message.trim()) {
        return value.message.trim();
    }

    return undefined;
}
