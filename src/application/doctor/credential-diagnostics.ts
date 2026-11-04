import type { TokenStore } from "../../auth/token-store.ts";
import type { DoctorCheck, CredentialDiagnosis } from "./doctor-types.ts";

type CredentialDependencies = {
    cacheToken?: boolean;
    tokenStore: Pick<TokenStore, "describeSource" | "inspectCredential">;
    toolAvailable: (command: string) => boolean;
};

export function diagnoseCredentials(
    dependencies: CredentialDependencies,
    checkToken = false,
): CredentialDiagnosis {
    const results: DoctorCheck[] = [];
    let description: ReturnType<TokenStore["describeSource"]>;
    try {
        description = dependencies.tokenStore.describeSource();
    } catch {
        return {
            readyForRemote: false,
            checks: [
                {
                    name: "Credential source",
                    status: checkToken ? "FAIL" : "WARN",
                    message:
                        "Secure token storage is unavailable on this platform. Set BB_TOKEN instead.",
                },
                {
                    name: "Token readability",
                    status: "SKIP",
                    message: "The token was not read because secure storage is unavailable.",
                },
            ],
        };
    }
    results.push({
        name: "Credential source",
        status: "OK",
        message: `${description.source} (expected source).`,
    });
    if (description.tool) {
        let available = false;
        try {
            available = dependencies.toolAvailable(description.tool);
        } catch {
            /* Report tool lookup failures without exposing native errors. */
        }
        results.push({
            name: "Credential tool",
            status: available ? "OK" : checkToken ? "FAIL" : "WARN",
            message: available
                ? `${description.tool} is available.`
                : `${description.tool} is unavailable or not executable. ${description.hint ?? "Install the backend tool and check PATH."} Alternatively, set BB_TOKEN.`,
        });
        if (!available) {
            results.push({
                name: "Token readability",
                status: "SKIP",
                message: "Token storage was not read because its required tool is unavailable.",
            });
            return { checks: results, readyForRemote: false };
        }
    }
    if (!checkToken) {
        results.push({
            name: "Token readability",
            status: "SKIP",
            message:
                "Run 'bb doctor --check-token' to read and validate the token. The operating system may prompt for storage access.",
        });
        return { checks: results, readyForRemote: false };
    }
    try {
        const source = dependencies.cacheToken
            ? dependencies.tokenStore.inspectCredential({ cacheForUse: true })
            : dependencies.tokenStore.inspectCredential();
        results.push({
            name: "Token readability",
            status: source ? "OK" : "FAIL",
            message: source
                ? "The token can be read and is locally valid."
                : "No token is configured. Run 'bb token set' or set BB_TOKEN.",
        });
        return { checks: results, readyForRemote: Boolean(source) };
    } catch {
        results.push({
            name: "Token readability",
            status: "FAIL",
            message:
                description.source === "BB_TOKEN"
                    ? "BB_TOKEN is invalid. Set a non-empty valid token or unset BB_TOKEN to use secure storage."
                    : `Unable to read or validate the stored token. ${description.hint ?? "Unlock the credential store and verify access with the account that owns it."} Alternatively, set BB_TOKEN.`,
        });
    }
    return { checks: results, readyForRemote: false };
}
