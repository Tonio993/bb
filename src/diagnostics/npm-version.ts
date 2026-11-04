import { spawnSync } from "node:child_process";

export function readNpmVersion(): string {
    const windows = process.platform === "win32";
    const result = spawnSync(
        windows ? process.env.ComSpec || "cmd.exe" : "npm",
        windows ? ["/d", "/s", "/c", "npm --version"] : ["--version"],
        {
            encoding: "utf8",
            windowsHide: true,
            timeout: 10000,
            maxBuffer: 64 * 1024,
            env: { ...process.env, BB_TOKEN: "" },
        },
    );
    if (result.error || result.signal || result.status !== 0) {
        throw new Error("Unable to determine the npm version.");
    }
    return result.stdout.trim();
}
