import { spawnSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(projectRoot, "dist");

if (dirname(outputDirectory) !== projectRoot) {
    throw new Error("Build output must stay inside the project directory.");
}

rmSync(outputDirectory, { recursive: true, force: true });

const result = spawnSync(
    process.execPath,
    [
        join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
        "--project",
        join(projectRoot, "tsconfig.build.json"),
    ],
    { stdio: "inherit", windowsHide: true },
);

if (result.error) {
    throw result.error;
}

if (result.status === 0) {
    chmodSync(join(outputDirectory, "main.js"), 0o755);
} else {
    process.exitCode = result.status ?? 1;
}
