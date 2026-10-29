import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";

import {
    dirname,
    join,
} from "node:path";

import {
    homedir,
} from "node:os";


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
        const config =
            this.loadRaw();

        const url =
            config.bitbucket?.url?.trim();

        if (!url) {
            throw missingConfigurationError(
                "bitbucket.url",
                "https://bitbucket.company.com",
            );
        }

        const projectKey =
            config.bitbucket?.projectKey?.trim();

        if (!projectKey) {
            throw missingConfigurationError(
                "bitbucket.projectKey",
                "PROJECT",
            );
        }

        const defaultReviewers =
            config.bitbucket
                ?.defaultReviewers
                ?.map(
                    (reviewer) =>
                        reviewer.trim(),
                )
                .filter(Boolean)
            ?? [];

        const remote =
            config.git?.remote?.trim()
            || "origin";

        return {
            bitbucket: {
                url:
                    url.replace(
                        /\/+$/,
                        "",
                    ),

                projectKey,

                defaultReviewers,
            },

            git: {
                remote,
            },
        };
    }


    get(
        key: ConfigKey,
    ): string | string[] | undefined {
        const config =
            this.loadRaw();

        switch (key) {
            case "bitbucket.url":
                return config.bitbucket
                    ?.url;

            case "bitbucket.projectKey":
                return config.bitbucket
                    ?.projectKey;

            case "bitbucket.defaultReviewers":
                return config.bitbucket
                    ?.defaultReviewers
                    ?? [];

            case "git.remote":
                return config.git?.remote
                    || "origin";
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
            case "bitbucket.url": {
                const normalized =
                    value.trim();

                if (!normalized) {
                    throw new Error(
                        "Bitbucket URL cannot be empty.",
                    );
                }

                config.bitbucket.url =
                    normalized.replace(
                        /\/+$/,
                        "",
                    );

                break;
            }

            case "bitbucket.projectKey": {
                const normalized =
                    value.trim();

                if (!normalized) {
                    throw new Error(
                        "Bitbucket project key cannot be empty.",
                    );
                }

                config.bitbucket.projectKey =
                    normalized;

                break;
            }

            case "bitbucket.defaultReviewers":
                config.bitbucket
                    .defaultReviewers =
                    parseReviewers(value);

                break;

            case "git.remote": {
                const normalized =
                    value.trim();

                if (!normalized) {
                    throw new Error(
                        "Git remote cannot be empty.",
                    );
                }

                config.git.remote =
                    normalized;

                break;
            }
        }

        this.saveRaw(config);
    }


    save(
        config: BbConfig,
    ): void {
        this.saveRaw(
            config,
        );
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
        mkdirSync(
            dirname(this.path),
            {
                recursive: true,
            },
        );

        writeFileSync(
            this.path,
            JSON.stringify(
                config,
                null,
                2,
            ) + "\n",
            "utf8",
        );
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


function parseReviewers(
    value: string,
): string[] {
    return value
        .split(",")
        .map(
            (reviewer) =>
                reviewer.trim(),
        )
        .filter(Boolean);
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
