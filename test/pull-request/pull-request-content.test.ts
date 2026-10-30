import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPullRequestContent } from "../../src/pull-request/pull-request-content.ts";

test("a single commit supplies the title while its description remains a Markdown list", () => {
    assert.deepEqual(
        buildPullRequestContent(
            [{ subject: "Implement payment validation", body: "" }],
            "feature/ABC-123",
        ),
        {
            title: "Implement payment validation",
            description: "* Implement payment validation",
        },
    );
});

test("multiple commits preserve their order, nested body lines, and Markdown separators", () => {
    assert.deepEqual(
        buildPullRequestContent(
            [
                { subject: "Add validation", body: " First detail\r\n\r\nSecond detail \r\n" },
                { subject: "Add coverage", body: "" },
            ],
            "feature/ABC-123",
        ),
        {
            title: "feature/ABC-123",
            description:
                "* Add validation\n    * First detail\n    * Second detail\n\n&nbsp;\n\n* Add coverage",
        },
    );
});

test("content generation requires at least one commit", () => {
    assert.throws(() => buildPullRequestContent([], "feature/ABC-123"), /without commits/);
});

test("a single commit retains its nested body while ignoring blank lines", () => {
    assert.deepEqual(
        buildPullRequestContent(
            [{ subject: "Validate payments", body: "\n First detail\n \nSecond detail \n" }],
            "feature/ABC-123",
        ),
        {
            title: "Validate payments",
            description: "* Validate payments\n    * First detail\n    * Second detail",
        },
    );
});

test("content generation accepts immutable commits and preserves Unicode and input order", () => {
    const commits = Object.freeze([
        Object.freeze({ subject: "Validate € amounts", body: "Handle café payments" }),
        Object.freeze({ subject: "Add 日本語 coverage", body: "" }),
    ]);
    assert.deepEqual(buildPullRequestContent(commits, "feature/ABC-123"), {
        title: "feature/ABC-123",
        description:
            "* Validate € amounts\n    * Handle café payments\n\n&nbsp;\n\n* Add 日本語 coverage",
    });
});
