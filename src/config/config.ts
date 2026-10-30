import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    openSync,
    closeSync,
    renameSync,
    rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

import {
    dirname,
    join,
    basename,
} from "node:path";

import {
    homedir,
} from "node:os";
import { normalizeBitbucketUrl } from "./bitbucket-url.ts";


export type BbConfig = {
    bitbucket: {
        url: string;
        projectKey: string;
        defaultReviewers: string[];
    };

    git: {
        remote: string;
    };
};


type RawConfig = {
    bitbucket?: {
        url?: string;
        projectKey?: string;
        defaultReviewers?: string[];
    };

    git?: {
        remote?: string;
    };
};


export const CONFIG_KEYS = [
    "bitbucket.url",
    "bitbucket.projectKey",
    "bitbucket.defaultReviewers",
    "git.remote",
] as const;


export type ConfigKey =
    typeof CONFIG_KEYS[number];

export type ConfigSnapshot = {
    readonly "bitbucket.url": string | undefined;
    readonly "bitbucket.projectKey": string | undefined;
    readonly "bitbucket.defaultReviewers": string[];
    readonly "git.remote": string;
};

export class ConfigStore {
    readonly path: string;


    constructor(
        path: string = getGlobalConfigPath(),
    ) {
        this.path = path;
    }


    exists(): boolean {
        return existsSync(
            this.path,
        );
    }


    loadRequired(): BbConfig {
        return requireConfiguration(this.snapshot());
    }

    snapshot(): ConfigSnapshot {
        return toSnapshot(normalizeConfig(this.loadRaw()));
    }

    get(
        key: ConfigKey,
    ): string | string[] | undefined {
        const config = this.loadRaw();
        switch (key) {
            case "bitbucket.url":
                return config.bitbucket?.url === undefined ? undefined : normalizeBitbucketUrl(config.bitbucket.url);
            case "bitbucket.projectKey":
                return config.bitbucket?.projectKey === undefined ? undefined : normalizeText(config.bitbucket.projectKey, "Bitbucket project key");
            case "bitbucket.defaultReviewers":
                return normalizeReviewers(config.bitbucket?.defaultReviewers ?? []);
            case "git.remote":
                return config.git?.remote === undefined ? "origin" : normalizeText(config.git.remote, "Git remote");
        }
    }


    set(
        key: ConfigKey,
        value: string,
    ): void {
        const config =
            this.loadRaw();

        config.bitbucket ??= {};
        config.git ??= {};

        switch (key) {
            case "bitbucket.url":
                config.bitbucket.url = value;
                break;
            case "bitbucket.projectKey":
                config.bitbucket.projectKey = value;
                break;
            case "bitbucket.defaultReviewers":
                config.bitbucket
                    .defaultReviewers =
                    value.split(",");

                break;

            case "git.remote":
                config.git.remote = value;
                break;
        }

        this.saveRaw(normalizeConfig(config));
    }


    save(
        config: BbConfig,
    ): void {
        const normalized = normalizeConfig(config);
        requireConfiguration(toSnapshot(normalized));
        this.saveRaw(normalized);
    }


    private loadRaw(): RawConfig {
        if (!this.exists()) {
            return {};
        }

        try {
            const content =
                readFileSync(
                    this.path,
                    "utf8",
                );

            const config: unknown = JSON.parse(
                content,
            );

            assertRawConfig(config);

            return config;
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            throw new Error(
                `Unable to read configuration file ` +
                `'${this.path}': ${message}`,
            );
        }
    }


    private saveRaw(
        config: RawConfig,
    ): void {
        const content = JSON.stringify(config, null, 2) + "\n";
        const directory = dirname(this.path);
        const temporaryPath = join(directory, `.${basename(this.path)}.${randomUUID()}.tmp`);
        try {
            mkdirSync(directory, { recursive: true });
            const descriptor = openSync(temporaryPath, "wx", 0o600);
            try {
                try {
                    writeFileSync(descriptor, content, "utf8");
                } finally {
                    closeSync(descriptor);
                }
                renameSync(temporaryPath, this.path);
            } finally {
                rmSync(temporaryPath, { force: true });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Unable to write configuration file '${this.path}': ${message}`);
        }
    }
}


function assertRawConfig(
    value: unknown,
): asserts value is RawConfig {
    if (!isObject(value)) {
        throw new Error(
            "Configuration must be a JSON object.",
        );
    }

    for (const section of ["bitbucket", "git"] as const) {
        if (
            value[section] !== undefined &&
            !isObject(value[section])
        ) {
            throw new Error(
                `Configuration section '${section}' must be an object.`,
            );
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

        if (key === "bitbucket.defaultReviewers") {
            if (
                !Array.isArray(entry) ||
                !entry.every((reviewer) => typeof reviewer === "string")
            ) {
                throw new Error(
                    `Configuration '${key}' must be an array of strings.`,
                );
            }
        } else if (typeof entry !== "string") {
            throw new Error(
                `Configuration '${key}' must be a string.`,
            );
        }
    }
}


function isObject(
    value: unknown,
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}


export function isConfigKey(
    value: string,
): value is ConfigKey {
    return (
        CONFIG_KEYS as readonly string[]
    ).includes(value);
}


export function getGlobalConfigPath(): string {
    let configDirectory: string;

    if (process.platform === "win32") {
        configDirectory =
            process.env.APPDATA
            || join(
                homedir(),
                "AppData",
                "Roaming",
            );
    } else if (
        process.platform === "darwin"
    ) {
        configDirectory =
            join(
                homedir(),
                "Library",
                "Application Support",
            );
    } else {
        configDirectory =
            process.env.XDG_CONFIG_HOME
            || join(
                homedir(),
                ".config",
            );
    }

    return join(
        configDirectory,
        "bb",
        "config.json",
    );
}


function normalizeConfig(value: unknown): RawConfig {
    assertRawConfig(value);
    const config: RawConfig = { ...value };
    if (value.bitbucket) {
        config.bitbucket = { ...value.bitbucket };
        if (value.bitbucket.url !== undefined) {
            config.bitbucket.url = normalizeBitbucketUrl(value.bitbucket.url);
        }
        if (value.bitbucket.projectKey !== undefined) {
            config.bitbucket.projectKey = normalizeText(value.bitbucket.projectKey, "Bitbucket project key");
        }
        if (value.bitbucket.defaultReviewers !== undefined) {
            config.bitbucket.defaultReviewers = normalizeReviewers(value.bitbucket.defaultReviewers);
        }
    }
    if (value.git) {
        config.git = { ...value.git };
        if (value.git.remote !== undefined) config.git.remote = normalizeText(value.git.remote, "Git remote");
    }
    return config;
}

function normalizeText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} cannot be empty.`);
    return normalized;
}

function normalizeReviewers(value: readonly string[]): string[] {
    return value.map((reviewer) => reviewer.trim()).filter(Boolean);
}

function toSnapshot(config: RawConfig): ConfigSnapshot {
    return {
        "bitbucket.url": config.bitbucket?.url,
        "bitbucket.projectKey": config.bitbucket?.projectKey,
        "bitbucket.defaultReviewers": config.bitbucket?.defaultReviewers ?? [],
        "git.remote": config.git?.remote ?? "origin",
    };
}

function requireConfiguration(config: ConfigSnapshot): BbConfig {
    const url = config["bitbucket.url"];
    if (!url) throw missingConfigurationError("bitbucket.url", "https://bitbucket.company.com");
    const projectKey = config["bitbucket.projectKey"];
    if (!projectKey) throw missingConfigurationError("bitbucket.projectKey", "PROJECT");
    return {
        bitbucket: { url, projectKey, defaultReviewers: config["bitbucket.defaultReviewers"] },
        git: { remote: config["git.remote"] },
    };
}


function missingConfigurationError(
    key: ConfigKey,
    example: string,
): Error {
    return new Error(
        `Required configuration '${key}' is missing.\n\n` +
        `Configure it with:\n` +
        `  bb config ${key} "${example}"\n\n` +
        `Or run:\n` +
        `  bb config init`,
    );
}
