export function readReleaseMetadata(
    tag: string,
    manifest: unknown,
    lock: unknown,
    changelog: string,
): {
    version: string;
    notes: string;
    filename: string;
} {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
        throw new Error("Release tags must use the stable format vX.Y.Z.");
    }
    const version = tag.slice(1);
    const pkg = object(manifest);
    const lockfile = object(lock);
    const root = object(object(lockfile.packages)[""]);
    if (
        pkg.name !== "bb" ||
        pkg.version !== version ||
        lockfile.version !== version ||
        root.version !== version ||
        root.name !== "bb"
    ) {
        throw new Error("Tag, package.json, and package-lock.json must agree on the bb version.");
    }
    const lines = changelog.replace(/\r\n/g, "\n").split("\n");
    const headings = lines.flatMap((line, index) =>
        line === "## [" + version + "]" || line.startsWith("## [" + version + "] - ")
            ? [index]
            : [],
    );
    if (headings.length !== 1)
        throw new Error("The changelog must contain exactly one section for this version.");
    const start = headings[0] + 1;
    const next = lines.findIndex((line, index) => index >= start && /^## /.test(line));
    const notes = lines
        .slice(start, next === -1 ? undefined : next)
        .join("\n")
        .trim();
    if (
        !notes ||
        !notes
            .split("\n")
            .some((line) => line.trim() && !line.startsWith("#") && !line.trim().startsWith("<!--"))
    ) {
        throw new Error("Release notes must describe the changes for this version.");
    }
    return { version, notes: notes + "\n", filename: "bb-" + version + ".tgz" };
}

function object(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Release manifests must be valid JSON objects.");
    }
    return value as Record<string, unknown>;
}
