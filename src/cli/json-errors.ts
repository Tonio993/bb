import { CommanderError } from "commander";
import { BitbucketApiError } from "../bitbucket/bitbucket-api-error.ts";
import { GitCommandError } from "../git/git-command-error.ts";
import type { JsonError, JsonErrorCode } from "./json-output-types.ts";

export function toJsonError(error: unknown): JsonError {
    if (error instanceof CommanderError) {
        return error.code === "bb.jsonUnsupported"
            ? {
                  code: "JSON_OUTPUT_UNSUPPORTED",
                  message: "JSON output is not supported for this command.",
              }
            : {
                  code: "CLI_ARGUMENT_ERROR",
                  message: "Invalid command arguments. Use --help to check the syntax.",
              };
    }
    if (error instanceof GitCommandError) {
        return {
            code: "GIT_ERROR",
            message: "A local Git operation failed. Check the checkout and configured remote.",
            ...(error.exitCode === undefined ? {} : { gitExitCode: error.exitCode }),
            ...(error.signal === undefined ? {} : { signal: error.signal }),
        };
    }
    if (error instanceof BitbucketApiError) {
        let code: JsonErrorCode;
        let message: string;
        if (error.kind === "timeout") {
            code = "TIMEOUT";
            message =
                "The Bitbucket request timed out. Check the server state before retrying a write.";
        } else if (error.kind === "connection") {
            code = "CONNECTION_FAILED";
            message = "Unable to connect to Bitbucket. Check the server URL and network.";
        } else if (error.kind === "response") {
            code = "INVALID_RESPONSE";
            message =
                "Bitbucket returned an invalid or unreadable response. Check the server state after a write.";
        } else {
            const status = error.statusCode;
            const failures: Record<number, { code: JsonErrorCode; message: string }> = {
                401: {
                    code: "AUTHENTICATION_FAILED",
                    message: "Bitbucket rejected authentication or credential scope.",
                },
                403: {
                    code: "ACCESS_DENIED",
                    message: "Bitbucket denied access to the operation.",
                },
                404: {
                    code: "NOT_FOUND",
                    message: "The Bitbucket resource was not found or is not accessible.",
                },
                409: {
                    code: "CONFLICT",
                    message: "Bitbucket rejected the operation because of a conflict.",
                },
                429: {
                    code: "RATE_LIMITED",
                    message: "Bitbucket rejected the request because of rate limiting.",
                },
            };
            const failure = status === undefined ? undefined : failures[status];
            code =
                failure?.code ??
                (status !== undefined && status >= 500 ? "BITBUCKET_UNAVAILABLE" : "HTTP_ERROR");
            message = failure?.message ?? "The Bitbucket request failed.";
        }
        return {
            code,
            message,
            ...(error.statusCode === undefined ? {} : { httpStatus: error.statusCode }),
            ...(error.method && ["GET", "POST", "PUT", "DELETE"].includes(error.method)
                ? { method: error.method }
                : {}),
            ...(error.kind === undefined ? {} : { kind: error.kind }),
        };
    }
    return {
        code: "APPLICATION_ERROR",
        message: "The operation failed. Check command arguments, configuration, and credentials.",
    };
}
