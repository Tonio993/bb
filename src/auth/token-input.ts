import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { Readable } from "node:stream";

export async function readTokenInput(
    fromStdin: boolean,
    input: Readable & { isTTY?: boolean } = stdin,
    output: Writable = stdout,
): Promise<string> {
    if (fromStdin) {
        input.setEncoding("utf8");
        let value = "";
        for await (const chunk of input) {
            value += chunk;
            if (Buffer.byteLength(value, "utf8") > 4096)
                throw new Error("Token input is too large.");
        }
        return value;
    }
    if (!input.isTTY) {
        throw new Error(
            "Interactive token entry requires a terminal. Use 'bb token set --stdin' for piped input.",
        );
    }
    const muted = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
    const readline = createInterface({ input, output: muted, terminal: true, historySize: 0 });
    try {
        output.write("Bitbucket token: ");
        const canceled = new Promise<never>((_resolve, reject) => {
            const cancel = () => reject(new Error("Token entry canceled."));
            readline.once("SIGINT", cancel);
            readline.once("close", cancel);
        });
        return await Promise.race([readline.question(""), canceled]);
    } finally {
        readline.close();
        muted.destroy();
        output.write("\n");
    }
}
