import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDescriptionInput } from "../../src/cli/description-input.ts";

test("description input decodes UTF-8, preserves empty content and rejects malformed bytes", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "bb-description-input-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "description.md");
    writeFileSync(path, Buffer.from([0xef, 0xbb, 0xbf, 0x41]));
    assert.deepEqual(loadDescriptionInput({ descriptionFile: path }), {
        kind: "literal",
        content: "A",
    });
    writeFileSync(path, "");
    assert.deepEqual(loadDescriptionInput({ template: path }), { kind: "template", content: "" });
    writeFileSync(path, Buffer.from([0xff, 0xfe]));
    assert.throws(() => loadDescriptionInput({ descriptionFile: path }), /UTF-8/);
    assert.equal(loadDescriptionInput({ template: false }, path), undefined);
    assert.throws(() => loadDescriptionInput({ descriptionFile: " " }), /cannot be empty/);
});
