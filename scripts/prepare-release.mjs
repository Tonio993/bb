import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readReleaseMetadata } from "./release-metadata.ts";

const root = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this script with npm run release:prepare -- vX.Y.Z.");
assert.equal(process.argv.length, 3, "Specify one release tag.");
const release = readReleaseMetadata(
    process.argv[2],
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")),
    readFileSync(join(root, "CHANGELOG.md"), "utf8"),
);
const output = join(root, "out", "release");
mkdirSync(output, { recursive: true });
assert.equal(
    readdirSync(output).length,
    0,
    "out/release must be empty before preparing a release.",
);
function npm(args) {
    const result = spawnSync(process.execPath, [npmCli, ...args], {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
        timeout: 300000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, "Release preparation stopped because an npm command failed.");
}
npm(["pack", "--pack-destination", output, "--json"]);
const tarball = join(output, release.filename);
// Validate the exact bytes that will be uploaded, without rebuilding another package.
npm(["run", "test:package", "--", tarball]);
const checksum = createHash("sha256").update(readFileSync(tarball)).digest("hex");
writeFileSync(join(output, "SHA256SUMS"), checksum + "  " + release.filename + "\n", "utf8");
writeFileSync(join(output, "release-notes.md"), release.notes, "utf8");
console.log("Validated release assets are ready in out/release.");
