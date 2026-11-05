import assert from "node:assert/strict";
import { test } from "node:test";
import { openUrl } from "../../src/browser/open-url.ts";
for (const platform of ["win32", "darwin", "linux"] as const) {
    test("browser dispatch uses arguments without a shell on " + platform, async () => {
        const calls: unknown[] = [];
        await openUrl("https://bitbucket.example/pr/42?x=1&y=2", {
            platform,
            execute: async (command, args) => {
                calls.push([command, args]);
            },
        });
        assert.deepEqual(calls, [
            [
                platform === "win32" ? "rundll32.exe" : platform === "darwin" ? "open" : "xdg-open",
                [
                    ...(platform === "win32" ? ["url.dll,FileProtocolHandler"] : []),
                    "https://bitbucket.example/pr/42?x=1&y=2",
                ],
            ],
        ]);
    });
}
for (const url of [
    "file:///tmp/test",
    "javascript:alert(1)",
    "https://user:secret@bitbucket.example",
    "https://bitbucket.example/\n",
]) {
    test("unsafe browser target is rejected: " + url, async () => {
        await assert.rejects(
            openUrl(url, {
                execute: async () => {
                    assert.fail("Must not execute.");
                },
            }),
        );
    });
}
