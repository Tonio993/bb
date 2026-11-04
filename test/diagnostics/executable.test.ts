import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { isExecutableAvailable } from "../../src/diagnostics/executable.ts";

test("executable lookup supports absolute paths, PATH entries with spaces, and skips directories", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "bb executable test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const command = process.platform === "win32" ? "test-tool.exe" : "test-tool";
    const executable = join(directory, command);
    writeFileSync(executable, "fake executable; never launched");
    chmodSync(executable, 0o700);
    assert.equal(isExecutableAvailable(executable, {}), true);
    assert.equal(
        isExecutableAvailable(command, {
            PATH: [join(directory, "missing"), directory].join(delimiter),
        }),
        true,
    );
    assert.equal(isExecutableAvailable(command, { PATH: `"${directory}"` }), true);
    assert.equal(isExecutableAvailable(command, {}), false);
    assert.equal(isExecutableAvailable(directory, {}), false);
    mkdirSync(join(directory, "directory-tool"));
    assert.equal(isExecutableAvailable("directory-tool", { PATH: directory }), false);
    if (process.platform !== "win32") {
        chmodSync(executable, 0o600);
        assert.equal(isExecutableAvailable(executable, {}), false);
    }
});
