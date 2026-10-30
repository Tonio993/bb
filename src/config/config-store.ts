import { randomUUID } from "node:crypto";
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
import { homedir } from "node:os";
import { dirname, join, basename } from "node:path";

import { normalizeBitbucketUrl } from "./bitbucket-url.ts";
import type { BbConfig, RawConfig, ConfigSnapshot, ConfigKey } from "./config-schema.ts";
import {
    assertRawConfig,
    normalizeConfig,
    normalizeText,
    normalizeReviewers,
    toSnapshot,
    requireConfiguration,
} from "./config-validation.ts";

export class ConfigStore {
    readonly path: string;

    constructor(path: string = getGlobalConfigPath()) {
        this.path = path;
    }

    exists(): boolean {
        return existsSync(this.path);
    }

    loadRequired(): BbConfig {
        return requireConfiguration(this.snapshot());
    }

    snapshot(): ConfigSnapshot {
        return toSnapshot(normalizeConfig(this.loadRaw()));
    }

    get(key: ConfigKey): string | string[] | undefined {
        const config = this.loadRaw();
        switch (key) {
            case "bitbucket.url":
                return config.bitbucket?.url === undefined
                    ? undefined
                    : normalizeBitbucketUrl(config.bitbucket.url);
            case "bitbucket.projectKey":
                return config.bitbucket?.projectKey === undefined
                    ? undefined
                    : normalizeText(config.bitbucket.projectKey, "Bitbucket project key");
            case "bitbucket.defaultReviewers":
                return normalizeReviewers(config.bitbucket?.defaultReviewers ?? []);
            case "git.remote":
                return config.git?.remote === undefined
                    ? "origin"
                    : normalizeText(config.git.remote, "Git remote");
        }
    }

    set(key: ConfigKey, value: string): void {
        const config = this.loadRaw();

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
                config.bitbucket.defaultReviewers = value.split(",");

                break;

            case "git.remote":
                config.git.remote = value;
                break;
        }

        this.saveRaw(normalizeConfig(config));
    }

    save(config: BbConfig): void {
        const normalized = normalizeConfig(config);
        requireConfiguration(toSnapshot(normalized));
        this.saveRaw(normalized);
    }

    private loadRaw(): RawConfig {
        if (!this.exists()) {
            return {};
        }

        try {
            const content = readFileSync(this.path, "utf8");

            const config: unknown = JSON.parse(content);

            assertRawConfig(config);

            return config;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            throw new Error(`Unable to read configuration file ` + `'${this.path}': ${message}`);
        }
    }

    private saveRaw(config: RawConfig): void {
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

export function getGlobalConfigPath(): string {
    let configDirectory: string;

    if (process.platform === "win32") {
        configDirectory = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    } else if (process.platform === "darwin") {
        configDirectory = join(homedir(), "Library", "Application Support");
    } else {
        configDirectory = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    }

    return join(configDirectory, "bb", "config.json");
}
