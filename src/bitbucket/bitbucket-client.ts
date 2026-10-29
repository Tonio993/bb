import type {
    BbConfig,
} from "../config/config.ts";

import {
    getBitbucketToken,
} from "../auth/token-store.ts";

import {
    BitbucketApiError,
} from "./bitbucket-api-error.ts";

type HttpMethod =
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE";

type TokenProvider =
    () => string;


export class BitbucketClient {
    private readonly baseUrl: string;
    private readonly tokenProvider: TokenProvider;

    constructor(
        config: BbConfig["bitbucket"],
        tokenProvider: TokenProvider = getBitbucketToken,
    ) {
        this.baseUrl = config.url.replace(/\/+$/, "");
        this.tokenProvider = tokenProvider;
    }


    async get<T>(
        path: string,
    ): Promise<T> {
        return this.request<T>(
            "GET",
            path,
        );
    }


    async post<T>(
        path: string,
        body?: unknown,
    ): Promise<T> {
        return this.request<T>(
            "POST",
            path,
            body,
        );
    }


    async put<T>(
        path: string,
        body?: unknown,
    ): Promise<T> {
        return this.request<T>(
            "PUT",
            path,
            body,
        );
    }


    async delete<T>(
        path: string,
    ): Promise<T> {
        return this.request<T>(
            "DELETE",
            path,
        );
    }


    private async request<T>(
        method: HttpMethod,
        path: string,
        body?: unknown,
    ): Promise<T> {
        const token =
            this.tokenProvider();

        const url =
            this.buildUrl(path);

        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        };

        const request: RequestInit = {
            method,
            headers,
        };

        if (body !== undefined) {
            headers["Content-Type"] =
                "application/json; charset=utf-8";

            request.body =
                JSON.stringify(body);
        }

        let response: Response;

        try {
            response =
                await fetch(
                    url,
                    request,
                );
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            throw new BitbucketApiError(
                `Unable to connect to Bitbucket: ${message}`,
                {
                    method,
                    path,
                },
            );
        }

        let responseBody: unknown;

        try {
            responseBody = await readResponseBody(response);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);

            throw new BitbucketApiError(
                `Unable to read Bitbucket response [${response.status}]: ${message}`,
                {
                    statusCode: response.status,
                    method,
                    path,
                },
            );
        }

        if (!response.ok) {
            const message =
                getBitbucketErrorMessage(
                    responseBody,
                    response.statusText,
                );

            throw new BitbucketApiError(
                `Bitbucket API request failed ` +
                `[${response.status}]: ${message}`,
                {
                    statusCode: response.status,
                    method,
                    path,
                },
            );
        }

        if (responseBody === undefined) {
            return undefined as T;
        }

        return responseBody as T;
    }


    private buildUrl(
        path: string,
    ): string {
        const normalizedPath =
            path.replace(/^\/+/, "");

        return `${this.baseUrl}/${normalizedPath}`;
    }
}


async function readResponseBody(
    response: Response,
): Promise<unknown> {
    const content =
        await response.text();

    if (!content.trim()) {
        return undefined;
    }

    try {
        return JSON.parse(content);
    } catch {
        return content;
    }
}


function getBitbucketErrorMessage(
    body: unknown,
    fallback: string,
): string {
    if (typeof body === "string") {
        const message =
            body.trim();

        if (message) {
            return message;
        }
    }

    if (
        typeof body === "object" &&
        body !== null
    ) {
        const value =
            body as Record<string, unknown>;

        if (Array.isArray(value.errors)) {
            const messages =
                value.errors
                    .map(getErrorEntryMessage)
                    .filter(
                        (message): message is string =>
                            Boolean(message),
                    );

            if (messages.length > 0) {
                return messages.join("; ");
            }
        }

        if (
            typeof value.message === "string" &&
            value.message.trim()
        ) {
            return value.message.trim();
        }
    }

    return fallback || "Unknown Bitbucket error.";
}


function getErrorEntryMessage(
    error: unknown,
): string | undefined {
    if (
        typeof error !== "object" ||
        error === null
    ) {
        return undefined;
    }

    const value =
        error as Record<string, unknown>;

    if (
        typeof value.message === "string" &&
        value.message.trim()
    ) {
        return value.message.trim();
    }

    return undefined;
}
