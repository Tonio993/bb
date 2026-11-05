import { readFileSync } from "node:fs";

export function readPackageVersion(): string {
    const manifest: unknown = JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    if (
        typeof manifest !== "object" ||
        manifest === null ||
        !("version" in manifest) ||
        typeof manifest.version !== "string" ||
        !manifest.version.trim()
    ) {
        throw new Error("The package manifest does not contain a valid version.");
    }
    return manifest.version;
}
