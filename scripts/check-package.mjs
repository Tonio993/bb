import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check with npm run test:package.");

const temporaryRoot = join(projectRoot, "tmp");
mkdirSync(temporaryRoot, { recursive: true });
const fixture = mkdtempSync(join(temporaryRoot, "bb-package-"));
assert.equal(dirname(resolve(fixture)), temporaryRoot);

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: fixture,
        encoding: "utf8",
        windowsHide: true,
        timeout: 120000,
        ...options,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}

function npm(args, options) {
    return run(process.execPath, [npmCli, ...args], options);
}

try {
    const artifacts = join(fixture, "artifacts");
    mkdirSync(artifacts);
    console.log("Building and packing the CLI...");
    const [packed] = JSON.parse(npm([
        "pack", "--json", "--foreground-scripts=false", "--pack-destination", artifacts,
    ], { cwd: projectRoot }));

    const expectedRuntime = readdirSync(join(projectRoot, "src"), { recursive: true })
        .filter((path) => path.endsWith(".ts"))
        .map((path) => `dist/${path.replaceAll("\\", "/").replace(/\.ts$/, ".js")}`);
    assert.deepEqual(packed.files.map(({ path }) => path).sort(), [
        ...expectedRuntime, "README.md", "package.json",
    ].sort(), "The package must contain only runtime JavaScript, its manifest, and README.");

    const prefix = join(fixture, "installed cli");
    console.log("Installing the tarball into an isolated prefix...");
    npm([
        "install", "--global", "--prefix", prefix, join(artifacts, packed.filename),
        "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline",
    ]);

    const installedPackage = process.platform === "win32"
        ? join(prefix, "node_modules", "bb")
        : join(prefix, "lib", "node_modules", "bb");
    const manifest = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8"));
    assert.equal(manifest.bin.bb, "dist/main.js");
    assert.ok(readFileSync(join(installedPackage, "dist", "main.js"), "utf8").startsWith("#!/usr/bin/env node\n"));
    assert.equal(existsSync(join(installedPackage, "src")), false);
    assert.equal(existsSync(join(installedPackage, "node_modules", "typescript")), false);

    // Invoke the generated npm launcher from outside the source checkout.
    const shim = process.platform === "win32" ? join(prefix, "bb.cmd") : join(prefix, "bin", "bb");
    const environment = {
        ...process.env,
        APPDATA: join(fixture, "user config"),
        XDG_CONFIG_HOME: join(fixture, "user config"),
        HOME: join(fixture, "user home"),
        USERPROFILE: join(fixture, "user home"),
    };
    console.log("Checking the installed bb launcher...");
    const help = process.platform === "win32"
        ? run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${shim}" --help"`], {
            env: environment, windowsVerbatimArguments: true,
        })
        : run(shim, ["--help"], { env: environment });
    assert.match(help, /Usage: bb/);
    assert.match(help, /merge-pr/);

    const main = join(installedPackage, "dist", "main.js");
    assert.match(run(process.execPath, [main, "merge-pr", "--help"], { env: environment }), /--complete-tasks/);
    assert.match(run(process.execPath, [main, "token", "status"], {
        env: { ...environment, BB_TOKEN: "package-smoke-token" },
    }), /Bitbucket token source: BB_TOKEN/);
    assert.equal(run(process.execPath, [main, "config", "git.remote"], { env: environment }).trim(), "origin");
    console.log("Package contents, production-only installation, and CLI smoke checks passed.");
} finally {
    assert.equal(dirname(resolve(fixture)), temporaryRoot);
    rmSync(fixture, { recursive: true, force: true });
}
