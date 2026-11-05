import assert from "node:assert/strict";
import { test } from "node:test";
import { readReleaseMetadata } from "../../scripts/release-metadata.ts";

const manifest = { name: "bb", version: "0.1.0" };
const lock = { version: "0.1.0", packages: { "": manifest } };
const changelog =
    "# Changelog\n\n## [Unreleased]\n\nFuture work\n\n## [0.1.0] - 2026-11-05\n\n- Initial CLI.\n\n## [0.0.1]\n\n- Earlier work.\n";
test("release metadata binds the tag and lock to one exact changelog section", () => {
    assert.deepEqual(readReleaseMetadata("v0.1.0", manifest, lock, changelog), {
        version: "0.1.0",
        filename: "bb-0.1.0.tgz",
        notes: "- Initial CLI.\n",
    });
});
for (const tag of ["0.1.0", "v01.1.0", "v0.1", "v0.1.0-beta.1", "v0.1.0+build", "v0.1.0/extra"]) {
    test("invalid stable release tag is rejected: " + tag, () => {
        assert.throws(() => readReleaseMetadata(tag, manifest, lock, changelog), /stable format/);
    });
}
for (const [pkg, lockfile] of [
    [{ ...manifest, version: "0.2.0" }, lock],
    [manifest, { ...lock, version: "0.2.0" }],
    [manifest, { ...lock, packages: { "": { ...manifest, version: "0.2.0" } } }],
    [{ ...manifest, name: "other" }, lock],
    [null, lock],
    [manifest, {}],
]) {
    test("inconsistent release manifests are rejected: " + JSON.stringify([pkg, lockfile]), () => {
        assert.throws(() => readReleaseMetadata("v0.1.0", pkg, lockfile, changelog));
    });
}
for (const text of [
    "# Changelog\n## [Unreleased]\n- Work",
    "## [0.1.0]\n\n## [0.0.1]\n- Other",
    "## [0.1.0]\n- One\n## [0.1.0]\n- Two",
]) {
    test("missing, empty or duplicate release notes are rejected: " + text, () => {
        assert.throws(
            () => readReleaseMetadata("v0.1.0", manifest, lock, text),
            /changelog|Release notes/,
        );
    });
}
