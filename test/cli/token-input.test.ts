import assert from "node:assert/strict";
import { PassThrough, Readable, Writable } from "node:stream";
import { test } from "node:test";
import { readTokenInput } from "../../src/cli/token-input.ts";

function terminal() {
    let raw = false;
    let displayed = "";
    const input = Object.assign(new PassThrough(), {
        isTTY: true,
        setRawMode(value: boolean) {
            raw = value;
            return this;
        },
    });
    const output = new Writable({
        write(chunk, _encoding, callback) {
            displayed += chunk.toString();
            callback();
        },
    });
    return { input, output, raw: () => raw, displayed: () => displayed };
}

test("interactive token entry is hidden and restores terminal mode", async () => {
    const tty = terminal();
    const answer = readTokenInput(false, tty.input, tty.output);
    assert.equal(tty.raw(), true);
    tty.input.write("hidden-token\r");
    assert.equal(await answer, "hidden-token");
    assert.equal(tty.raw(), false);
    assert.equal(tty.displayed(), "Bitbucket token: \n");
    tty.input.destroy();
});

test("interactive editing works without exposing the token", async () => {
    const tty = terminal();
    const answer = readTokenInput(false, tty.input, tty.output);
    tty.input.write("tokenX\x7f\r");
    assert.equal(await answer, "token");
    assert.ok(!tty.displayed().includes("tokenX"));
    tty.input.destroy();
});

for (const action of ["interrupt", "EOF"]) {
    test(`${action} cancels token entry and restores terminal mode`, async () => {
        const tty = terminal();
        const answer = readTokenInput(false, tty.input, tty.output);
        tty.input.write("partial-secret");
        if (action === "interrupt") tty.input.write("\x03");
        else tty.input.end();
        await assert.rejects(answer, /Token entry canceled/);
        assert.equal(tty.raw(), false);
        assert.ok(!tty.displayed().includes("partial-secret"));
        tty.input.destroy();
    });
}

test("redirected input requires the explicit stdin option", async () => {
    await assert.rejects(readTokenInput(false, Readable.from(["secret"])), /--stdin/);
});

test("stdin input supports chunked UTF-8 data without displaying it", async () => {
    const output = new PassThrough();
    let displayed = "";
    output.on("data", (chunk) => {
        displayed += chunk.toString();
    });
    assert.equal(
        await readTokenInput(true, Readable.from(["token", "-value\n"]), output),
        "token-value\n",
    );
    assert.equal(displayed, "");
});

test("oversized stdin input is rejected", async () => {
    await assert.rejects(
        readTokenInput(true, Readable.from(["x".repeat(4097)])),
        /input is too large/,
    );
});
