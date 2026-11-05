import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check with npm run test:git.");
const npmVersion = JSON.parse(
    readFileSync(resolve(dirname(npmCli), "..", "package.json"), "utf8"),
).version;
const [major, minor, patch] = npmVersion.split(".").map(Number);
assert.ok(
    major > 12 || (major === 12 && (minor > 2 || (minor === 2 && patch >= 1))),
    "Git installation requires npm >=12.2.1. Run: npm exec --yes --package=npm@12.2.1 -- npm run test:git",
);

const temporaryRoot = join(projectRoot, "tmp");
mkdirSync(temporaryRoot, { recursive: true });
const fixture = mkdtempSync(join(temporaryRoot, "bb-git-install-"));
assert.equal(dirname(resolve(fixture)), temporaryRoot);
const source = join(fixture, "source repository");
const prefix = join(fixture, "installed cli");
const environment = {
    ...process.env,
    APPDATA: join(fixture, "user config"),
    XDG_CONFIG_HOME: join(fixture, "user config"),
    HOME: join(fixture, "user home"),
    USERPROFILE: join(fixture, "user home"),
    BB_TOKEN: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(fixture, "empty git config"),
};

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: fixture,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 300000,
        ...options,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}

try {
    mkdirSync(source);
    for (const path of [
        "src",
        "tsconfig.json",
        "tsconfig.build.json",
        "package.json",
        "package-lock.json",
        "README.md",
        "CHANGELOG.md",
        "docs/json-output.md",
        ".gitignore",
        "scripts/build.mjs",
    ]) {
        cpSync(join(projectRoot, path), join(source, path), { recursive: true });
    }
    assert.equal(existsSync(join(source, "dist")), false);
    assert.equal(existsSync(join(source, "node_modules")), false);

    console.log("Creating an isolated Git source without compiled files...");
    run("git", [
        "config",
        "--file",
        environment.GIT_CONFIG_GLOBAL,
        "--add",
        "safe.directory",
        source,
    ]);
    run("git", ["init", "--quiet", source]);
    run("git", ["add", "."], { cwd: source });
    run(
        "git",
        [
            "-c",
            "user.name=Package test",
            "-c",
            "user.email=package-test@example.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "--quiet",
            "-m",
            "Package installation fixture",
        ],
        { cwd: source },
    );
    const commit = run("git", ["rev-parse", "HEAD"], { cwd: source }).trim();
    const gitSpec = `git+${pathToFileURL(source).href}#${commit}`;

    console.log("Installing the Git dependency and building it through prepare...");
    run(process.execPath, [
        npmCli,
        "install",
        "--allow-git=all",
        `--allow-scripts=${gitSpec}`,
        "--global",
        "--prefix",
        prefix,
        gitSpec,
        "--no-audit",
        "--no-fund",
        "--cache",
        join(fixture, "npm cache"),
    ]);

    const installedPackage =
        process.platform === "win32"
            ? join(prefix, "node_modules", "bb")
            : join(prefix, "lib", "node_modules", "bb");
    assert.ok(existsSync(join(installedPackage, "dist", "main.js")));
    assert.equal(
        readFileSync(join(installedPackage, "docs", "json-output.md"), "utf8"),
        readFileSync(join(projectRoot, "docs", "json-output.md"), "utf8"),
    );
    assert.equal(existsSync(join(installedPackage, "src")), false);
    for (const dependency of ["typescript", "prettier", "@types/node"]) {
        assert.equal(existsSync(join(installedPackage, "node_modules", dependency)), false);
    }
    assert.equal(
        JSON.parse(
            readFileSync(
                join(installedPackage, "node_modules", "commander", "package.json"),
                "utf8",
            ),
        ).name,
        "commander",
    );

    const shim = process.platform === "win32" ? join(prefix, "bb.cmd") : join(prefix, "bin", "bb");
    const help =
        process.platform === "win32"
            ? run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${shim}" --help"`], {
                  windowsVerbatimArguments: true,
              })
            : run(shim, ["--help"]);
    assert.match(help, /Usage: bb/);
    assert.match(help, /merge-pr/);
    const main = join(installedPackage, "dist", "main.js");
    assert.equal(
        run(process.execPath, [main, "--version"]).trim(),
        JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version,
    );
    console.log("Git installation, compiled launcher, and production dependencies passed.");
} finally {
    assert.equal(dirname(resolve(fixture)), temporaryRoot);
    rmSync(fixture, { recursive: true, force: true });
}
