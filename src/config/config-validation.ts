import { normalizeBitbucketUrl } from "./bitbucket-url.ts";
import { normalizeSshHostnames } from "./ssh-hostnames.ts";
import { CONFIG_KEYS } from "./config-schema.ts";
import type { BbConfig, RawConfig, ConfigSnapshot, ConfigKey } from "./config-schema.ts";

export function assertRawConfig(value: unknown): asserts value is RawConfig {
    if (!isObject(value)) {
        throw new Error("Configuration must be a JSON object.");
    }

    for (const section of ["bitbucket", "git"] as const) {
        if (value[section] !== undefined && !isObject(value[section])) {
            throw new Error(`Configuration section '${section}' must be an object.`);
        }
    }

    for (const key of CONFIG_KEYS) {
        const [section, name] = key.split(".");
        const sectionValue = value[section];

        if (!isObject(sectionValue)) {
            continue;
        }

        const entry = sectionValue[name];

        if (entry === undefined) {
            continue;
        }

        if (key === "bitbucket.defaultReviewers" || key === "bitbucket.sshHostnames") {
            if (!Array.isArray(entry) || !entry.every((item) => typeof item === "string")) {
                throw new Error(`Configuration '${key}' must be an array of strings.`);
            }
        } else if (typeof entry !== "string") {
            throw new Error(`Configuration '${key}' must be a string.`);
        }
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeConfig(value: unknown): RawConfig {
    assertRawConfig(value);
    const config: RawConfig = { ...value };
    if (value.bitbucket) {
        config.bitbucket = { ...value.bitbucket };
        if (value.bitbucket.url !== undefined) {
            config.bitbucket.url = normalizeBitbucketUrl(value.bitbucket.url);
        }
        if (value.bitbucket.projectKey !== undefined) {
            config.bitbucket.projectKey = normalizeText(
                value.bitbucket.projectKey,
                "Bitbucket project key",
            );
        }
        if (value.bitbucket.defaultReviewers !== undefined) {
            config.bitbucket.defaultReviewers = normalizeReviewers(
                value.bitbucket.defaultReviewers,
            );
        }
        if (value.bitbucket.sshHostnames !== undefined) {
            config.bitbucket.sshHostnames = normalizeSshHostnames(value.bitbucket.sshHostnames);
        }
    }
    if (value.git) {
        config.git = { ...value.git };
        if (value.git.remote !== undefined)
            config.git.remote = normalizeText(value.git.remote, "Git remote");
    }
    return config;
}

export function normalizeText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} cannot be empty.`);
    return normalized;
}

export function normalizeReviewers(value: readonly string[]): string[] {
    return value.map((reviewer) => reviewer.trim()).filter(Boolean);
}

export function toSnapshot(config: RawConfig): ConfigSnapshot {
    return {
        "bitbucket.url": config.bitbucket?.url,
        "bitbucket.projectKey": config.bitbucket?.projectKey,
        "bitbucket.defaultReviewers": config.bitbucket?.defaultReviewers ?? [],
        "bitbucket.sshHostnames": config.bitbucket?.sshHostnames ?? [],
        "git.remote": config.git?.remote ?? "origin",
    };
}

export function requireConfiguration(config: ConfigSnapshot): BbConfig {
    const url = config["bitbucket.url"];
    if (!url) throw missingConfigurationError("bitbucket.url", "https://bitbucket.company.com");
    const projectKey = config["bitbucket.projectKey"];
    return {
        bitbucket: {
            url,
            projectKey,
            defaultReviewers: config["bitbucket.defaultReviewers"],
            sshHostnames: config["bitbucket.sshHostnames"],
        },
        git: { remote: config["git.remote"] },
    };
}

export function requireProjectKey(configured: string | undefined, override?: string): string {
    const projectKey = override?.trim() || configured?.trim();
    if (!projectKey) {
        throw new Error(
            "A Bitbucket project is required. Specify '--project-key <key>' or configure it with:\n" +
                '  bb config bitbucket.projectKey "PROJECT"',
        );
    }
    return projectKey;
}

function missingConfigurationError(key: ConfigKey, example: string): Error {
    return new Error(
        `Required configuration '${key}' is missing.\n\n` +
            `Configure it with:\n` +
            `  bb config ${key} "${example}"\n\n` +
            `Or run:\n` +
            `  bb config init`,
    );
}
