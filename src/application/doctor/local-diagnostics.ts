import type { ConfigStore } from "../../config/config-store.ts";
import type { DoctorCheck, LocalDiagnosis } from "./doctor-types.ts";

type DoctorDependencies = {
    nodeVersion: string;
    npmVersion: () => string;
    gitVersion: () => string;
    configStore: Pick<ConfigStore, "path" | "exists" | "snapshot" | "get">;
};

export function diagnoseLocalEnvironment(
    dependencies: DoctorDependencies,
    remote = false,
): LocalDiagnosis {
    const results: DoctorCheck[] = [];
    let serverUrl: string | undefined;
    const node = parseVersion(dependencies.nodeVersion);
    results.push({
        name: "Node.js",
        status: node && node[0] >= 24 ? "OK" : "FAIL",
        message:
            node && node[0] >= 24
                ? dependencies.nodeVersion
                : "Node.js >=24.0.0 is required. Install a supported Node.js version.",
    });

    try {
        const version = dependencies.npmVersion().trim();
        const npm = parseVersion(version);
        if (!npm) throw new Error("Invalid npm version.");
        const supportsGitInstall =
            npm[0] > 12 || (npm[0] === 12 && (npm[1] > 2 || (npm[1] === 2 && npm[2] >= 1)));
        const supportsNpm12 = node && (node[0] > 24 || (node[0] === 24 && node[1] >= 15));
        results.push({
            name: "npm",
            status: supportsGitInstall && supportsNpm12 ? "OK" : "WARN",
            message:
                supportsGitInstall && supportsNpm12
                    ? version
                    : `${version}. Git installation requires Node.js >=24.15.0 and npm >=12.2.1. ${supportsNpm12 ? "Upgrade npm with 'npm install --global npm@12.2.1'." : "Upgrade Node.js to a compatible version before installing npm 12.2.1."}`,
        });
    } catch {
        results.push({
            name: "npm",
            status: "FAIL",
            message:
                "Unable to determine the npm version. Ensure npm is installed and available in PATH.",
        });
    }

    try {
        const version = dependencies.gitVersion().trim();
        if (!/^git version \d+\.\d+(?:\.\d+)?(?:[.\w+() -]*)$/.test(version)) {
            throw new Error("Invalid Git version.");
        }
        results.push({ name: "Git", status: "OK", message: version });
    } catch {
        results.push({
            name: "Git",
            status: "FAIL",
            message: "Unable to execute Git. Ensure Git is installed and available in PATH.",
        });
    }

    const store = dependencies.configStore;
    results.push({ name: "Configuration path", status: "OK", message: store.path });
    try {
        if (!store.exists()) {
            results.push({
                name: "Configuration",
                status: "WARN",
                message:
                    "No configuration file found. Run 'bb config init' to configure Bitbucket.",
            });
        } else {
            const snapshot = store.snapshot();
            serverUrl = snapshot["bitbucket.url"];
            const missing = (["bitbucket.url", "bitbucket.projectKey"] as const).filter(
                (key) => !snapshot[key],
            );
            results.push({
                name: "Configuration",
                status: missing.length ? "WARN" : "OK",
                message: missing.length
                    ? `Missing required settings: ${missing.join(", ")}. Run 'bb config init'.`
                    : "Configuration is valid.",
            });
        }
    } catch {
        results.push({
            name: "Configuration",
            status: "FAIL",
            message:
                "Configuration is unreadable or invalid. Check file access, JSON syntax, and setting types and values. No file contents were displayed.",
        });
        // Recover a usable URL only when another setting prevented the full snapshot validation.
        if (remote) {
            try {
                const value = store.get("bitbucket.url");
                if (typeof value === "string") serverUrl = value;
            } catch {
                /* The configuration failure is already reported without its contents. */
            }
        }
    }
    return { checks: results, serverUrl };
}

function parseVersion(value: string): [number, number, number] | undefined {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}
