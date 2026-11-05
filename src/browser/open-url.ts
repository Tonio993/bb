import { execFile } from "node:child_process";
import { promisify } from "node:util";

type BrowserCommand = (command: string, args: string[]) => Promise<void>;
const executeFile = promisify(execFile);

export async function openUrl(
    value: string,
    options: { platform?: NodeJS.Platform; execute?: BrowserCommand } = {},
): Promise<void> {
    const url = new URL(value);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        /[\s\p{Cc}]/u.test(value)
    )
        throw new Error("The browser requires a safe HTTP(S) URL.");
    const platform = options.platform ?? process.platform;
    const execute: BrowserCommand =
        options.execute ??
        (async (command, args) => {
            await executeFile(command, args, { windowsHide: true, timeout: 10000 });
        });
    if (platform === "win32")
        await execute("rundll32.exe", ["url.dll,FileProtocolHandler", url.href]);
    else if (platform === "darwin") await execute("open", [url.href]);
    else if (platform === "linux") await execute("xdg-open", [url.href]);
    else throw new Error("Opening the browser is not supported on this platform.");
}
