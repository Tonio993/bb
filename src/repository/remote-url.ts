import type { ParsedBitbucketRemote } from "./remote-url-types.ts";

export function parseBitbucketRemoteUrl(value: string): ParsedBitbucketRemote {
    try {
        const input = value.trim();
        if (!input || /[\\\s\p{Cc}?#]/u.test(input)) throw invalidRemote();
        const { url, rawPath } = parseAddress(input);
        const protocol =
            url.protocol === "https:" ? "https" : url.protocol === "http:" ? "http" : "ssh";
        if (!url.hostname || /[%*]/.test(url.hostname)) throw invalidRemote();
        const port = url.port ? Number(url.port) : undefined;
        if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
            throw invalidRemote();
        }

        // Inspect the original segments: URL would silently collapse dot segments.
        const segments = rawPath
            .replace(/^\//, "")
            .replace(/\/$/, "")
            .split("/")
            .map((segment) => {
                const decoded = decodeURIComponent(segment);
                if (
                    !decoded ||
                    decoded === "." ||
                    decoded === ".." ||
                    /[\\/:%\s\p{Cc}?#]/u.test(decoded)
                ) {
                    throw invalidRemote();
                }
                return decoded;
            });
        const isHttp = protocol !== "ssh";
        const suffixLength = isHttp ? 3 : 2;
        if (segments.length < suffixLength || (isHttp && segments.at(-3) !== "scm")) {
            throw invalidRemote();
        }
        const projectKey = segments.at(-2)!;
        const repository = segments.at(-1)!.replace(/\.git$/, "");
        if (
            !/^(?:[a-z0-9][a-z0-9_-]*|~[a-z0-9][a-z0-9._-]*)$/i.test(projectKey) ||
            !/^[a-z0-9._-]+$/i.test(repository) ||
            repository === "." ||
            repository === ".."
        ) {
            throw invalidRemote();
        }
        const prefix = segments.slice(0, -suffixLength);
        return {
            protocol,
            hostname: url.hostname.toLowerCase(),
            port,
            contextPath: prefix.length ? "/" + prefix.map(encodeURIComponent).join("/") : "",
            projectKey,
            repository,
        };
    } catch {
        // URL and decoding errors may contain the input, including embedded credentials.
        throw invalidRemote();
    }
}

function parseAddress(input: string): { url: URL; rawPath: string } {
    if (input.includes("://")) {
        const match = /^(https?|ssh):\/\/([^/]+)(\/.*)?$/i.exec(input);
        if (!match) throw invalidRemote();
        return { url: new URL(input), rawPath: match[3] ?? "" };
    }
    // A drive letter is a local Windows path, not an SSH host.
    if (/^[a-z]:/i.test(input)) throw invalidRemote();
    const match = /^(?:[^/@:]+@)?(\[[^\]]+\]|[^/@:]+):(.+)$/.exec(input);
    if (!match) throw invalidRemote();
    const rawPath = match[2];
    return { url: new URL(`ssh://${match[1]}/${rawPath.replace(/^\//, "")}`), rawPath };
}

function invalidRemote(): Error {
    return new Error(
        "Unable to recognize the Bitbucket remote URL. Expected an HTTP(S) clone URL with '/scm/<project>/<repository>' or an SSH clone URL with '<project>/<repository>'.",
    );
}
