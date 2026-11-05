import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runCli } from "../../src/cli/cli.ts";
import { readPackageVersion } from "../../src/cli/version.ts";
import type { CommandContext } from "../../src/cli/command-context.ts";

for (const args of [
    ["--version"],
    ["-V"],
    ["--json", "--version"],
    ["-C", "missing-directory", "--version"],
]) {
    test("version exits successfully without resolving services: " + args.join(" "), async (t) => {
        let stdout = "";
        let stderr = "";
        t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
            stdout += chunk.toString();
            return true;
        });
        t.mock.method(process.stderr, "write", (chunk: string | Uint8Array) => {
            stderr += chunk.toString();
            return true;
        });
        const context = new Proxy({} as CommandContext, {
            get() {
                throw new Error("Services must remain lazy.");
            },
        });
        await runCli(args, context);
        const manifest = JSON.parse(
            readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
        ) as { version: string };
        assert.equal(stdout, manifest.version + "\n");
        assert.equal(stderr, "");
        assert.equal(readPackageVersion(), manifest.version);
    });
}
