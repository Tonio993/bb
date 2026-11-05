export type BbConfig = {
    bitbucket: {
        url: string;
        projectKey?: string;
        defaultReviewers: string[];
        sshHostnames: string[];
        descriptionTemplate?: string;
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
        sshHostnames?: string[];
        descriptionTemplate?: string;
    };

    git?: {
        remote?: string;
    };
};

export const CONFIG_KEYS = [
    "bitbucket.url",
    "bitbucket.projectKey",
    "bitbucket.defaultReviewers",
    "bitbucket.sshHostnames",
    "git.remote",
    "bitbucket.descriptionTemplate",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export type ConfigSnapshot = {
    readonly "bitbucket.url": string | undefined;
    readonly "bitbucket.projectKey": string | undefined;
    readonly "bitbucket.defaultReviewers": string[];
    readonly "bitbucket.sshHostnames": string[];
    readonly "git.remote": string;
    readonly "bitbucket.descriptionTemplate"?: string;
};

export function isConfigKey(value: string): value is ConfigKey {
    return (CONFIG_KEYS as readonly string[]).includes(value);
}
