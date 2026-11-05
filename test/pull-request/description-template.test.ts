import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDescriptionTemplate } from "../../src/pull-request/description-template.ts";
const values = {
    title: "Title $&",
    commits: "{{unknown}}",
    projectKey: "P",
    repository: "r",
    sourceBranch: "feature/test",
    targetBranch: "main",
};
test("templates replace known placeholders once without evaluating inserted content", () => {
    assert.equal(
        renderDescriptionTemplate("{{title}} {{ title }}\n{{commits}}", values),
        "Title $& Title $&\n{{unknown}}",
    );
});
test("unknown template placeholders are rejected", () => {
    for (const template of ["{{missing}}", "{{unknown_name}}", "{{title.length}}", "{{}}"]) {
        assert.throws(
            () => renderDescriptionTemplate(template, values),
            /Unknown Pull Request template placeholder/,
        );
    }
});
