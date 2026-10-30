export function normalizeBitbucketUrl(value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error("Bitbucket URL cannot be empty.");
    const invalid = () => new Error(
        "Invalid Bitbucket URL. Configure an absolute HTTP or HTTPS URL without credentials, wildcards, query parameters, or fragments. " +
        "Use 'bb config bitbucket.url' to correct it.",
    );
    if (!/^https?:\/\//i.test(normalized) || /[\s\p{Cc}]/u.test(normalized)) throw invalid();
    let url: URL;
    try {
        url = new URL(normalized);
    } catch {
        throw invalid();
    }
    if (
        !["http:", "https:"].includes(url.protocol) || !url.hostname ||
        url.hostname.includes("*") || url.username || url.password ||
        normalized.includes("?") || normalized.includes("#")
    ) {
        throw invalid();
    }
    return url.href.replace(/\/+$/, "");
}
