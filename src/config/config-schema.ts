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

export type RawConfig = {
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

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export type ConfigSnapshot = {
    readonly "bitbucket.url": string | undefined;
    readonly "bitbucket.projectKey": string | undefined;
    readonly "bitbucket.defaultReviewers": string[];
    readonly "git.remote": string;
};

export function isConfigKey(value: string): value is ConfigKey {
    return (CONFIG_KEYS as readonly string[]).includes(value);
}
