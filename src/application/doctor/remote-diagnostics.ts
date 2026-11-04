import type { BitbucketApiErrorOptions } from "../../bitbucket/bitbucket-api-error.ts";
import type { BitbucketApi } from "../../bitbucket/bitbucket-client.ts";
import { BitbucketApiError } from "../../bitbucket/bitbucket-api-error.ts";
import { checkAuthenticatedAccess } from "../../bitbucket/authentication.ts";
import type { DoctorCheck } from "./doctor-types.ts";

export async function diagnoseRemoteAccess(
    createClient: () => Pick<BitbucketApi, "get">,
): Promise<DoctorCheck[]> {
    try {
        await checkAuthenticatedAccess(createClient());
        return [
            {
                name: "Remote connection",
                status: "OK",
                message: "Bitbucket returned a valid dashboard response.",
            },
            {
                name: "Remote authentication",
                status: "OK",
                message:
                    "Authenticated dashboard access succeeded. Project and repository permissions were not checked.",
            },
        ];
    } catch (error) {
        return classifyRemoteFailure(error instanceof BitbucketApiError ? error : {});
    }
}

export function classifyRemoteFailure(
    failure: Pick<BitbucketApiErrorOptions, "kind" | "statusCode">,
): DoctorCheck[] {
    const status = failure.statusCode;
    let message: string;
    if (failure.kind === "timeout")
        message = "The remote check timed out. Check the network and server availability.";
    else if (failure.kind === "response" && status !== undefined && status >= 200 && status < 300)
        message =
            "The server response is not valid Bitbucket dashboard JSON. Check the base URL, context path, proxy, and SSO configuration.";
    else if (status === 401)
        message =
            "Authentication was rejected (HTTP 401). Verify token validity and read permissions; update it with 'bb token set' or BB_TOKEN if needed.";
    else if (status === 403)
        message =
            "Access was denied (HTTP 403). Check account restrictions and token permissions. Authentication could not be confirmed.";
    else if (status === 404)
        message =
            "The dashboard endpoint was not found (HTTP 404). Check the base URL, context path, and Bitbucket version.";
    else if (status !== undefined && status >= 300 && status < 400)
        message =
            "The server returned a redirect. Check the base URL and SSO configuration. Redirects are not followed.";
    else if (status === 429)
        message =
            "The server rate limit was reached (HTTP 429). Wait before running the command again; no automatic retry was attempted.";
    else if (status !== undefined && status >= 500)
        message = `The server or proxy failed (HTTP ${status}). Check server availability.`;
    else if (status !== undefined)
        message = `The remote check failed (HTTP ${status}). Check server configuration and access policies.`;
    else
        message =
            "Unable to connect to Bitbucket. Check DNS, network, proxy, and TLS certificates.";
    return [
        {
            name: "Remote connection",
            status: status !== undefined ? "OK" : "FAIL",
            message: status !== undefined ? `An HTTP response was received (${status}).` : message,
        },
        {
            name: "Remote authentication",
            status: status !== undefined ? "FAIL" : "SKIP",
            message:
                status !== undefined
                    ? message
                    : "Authentication could not be checked without a server response.",
        },
    ];
}
