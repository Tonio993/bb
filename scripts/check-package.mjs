import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check with npm run test:package.");

const temporaryRoot = join(projectRoot, "tmp");
mkdirSync(temporaryRoot, { recursive: true });
const fixture = mkdtempSync(join(temporaryRoot, "bb-package-"));
assert.equal(dirname(resolve(fixture)), temporaryRoot);

function run(command, args, options = {}, expectedStatus = 0) {
    const result = spawnSync(command, args, {
        cwd: fixture,
        encoding: "utf8",
        windowsHide: true,
        timeout: 120000,
        ...options,
    });
    assert.ifError(result.error);
    assert.equal(
        result.status,
        expectedStatus,
        `${command} failed:\n${result.stdout}\n${result.stderr}`,
    );
    return result.stdout;
}

function npm(args, options) {
    return run(process.execPath, [npmCli, ...args], options);
}

try {
    const artifacts = join(fixture, "artifacts");
    mkdirSync(artifacts);
    console.log("Building and packing the CLI...");
    const packOutput = JSON.parse(
        npm(["pack", "--json", "--foreground-scripts=false", "--pack-destination", artifacts], {
            cwd: projectRoot,
        }),
    );
    // npm 11 returns an array; npm 12 keys the results by package name.
    const packages = Array.isArray(packOutput) ? packOutput : Object.values(packOutput);
    assert.equal(packages.length, 1, "Expected exactly one packed package.");
    const [packed] = packages;

    const expectedRuntime = readdirSync(join(projectRoot, "src"), { recursive: true })
        .filter((path) => path.endsWith(".ts"))
        .map((path) => `dist/${path.replaceAll("\\", "/").replace(/\.ts$/, ".js")}`);
    const packedPaths = packed.files.map(({ path }) => path);
    assert.deepEqual(packed.bundled, ["commander"]);
    assert.deepEqual(
        packedPaths.filter((path) => !path.startsWith("node_modules/commander/")).sort(),
        [...expectedRuntime, "README.md", "package.json"].sort(),
        "The package must contain only runtime JavaScript, its manifest, README, and bundled Commander.",
    );
    for (const file of ["package.json", "index.js", "lib/command.js", "LICENSE"]) {
        assert.ok(
            packedPaths.includes(`node_modules/commander/${file}`),
            `Bundled Commander is missing ${file}.`,
        );
    }

    const prefix = join(fixture, "installed cli");
    console.log("Installing the tarball offline with an empty cache into an isolated prefix...");
    npm([
        "install",
        "--global",
        "--prefix",
        prefix,
        join(artifacts, packed.filename),
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--offline",
        "--cache",
        join(fixture, "empty npm cache"),
    ]);

    const installedPackage =
        process.platform === "win32"
            ? join(prefix, "node_modules", "bb")
            : join(prefix, "lib", "node_modules", "bb");
    const manifest = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8"));
    assert.equal(manifest.bin.bb, "dist/main.js");
    assert.deepEqual(manifest.bundleDependencies, ["commander"]);
    assert.equal(
        JSON.parse(
            readFileSync(
                join(installedPackage, "node_modules", "commander", "package.json"),
                "utf8",
            ),
        ).name,
        "commander",
    );
    assert.ok(
        readFileSync(join(installedPackage, "dist", "main.js"), "utf8").startsWith(
            "#!/usr/bin/env node\n",
        ),
    );
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
    const help =
        process.platform === "win32"
            ? run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${shim}" --help"`], {
                  env: environment,
                  windowsVerbatimArguments: true,
              })
            : run(shim, ["--help"], { env: environment });
    assert.match(help, /Usage: bb/);
    assert.match(help, /merge-pr/);
    assert.match(help, /doctor/);

    const main = join(installedPackage, "dist", "main.js");
    for (const command of ["get-pr-url", "create-pr", "merge-pr"]) {
        const commandHelp = run(process.execPath, [main, command, "--help"], { env: environment });
        assert.match(commandHelp, /--repository <slug>/);
        assert.match(commandHelp, /--project-key <key>/);
    }
    const doctorHelp = run(process.execPath, [main, "doctor", "--help"], { env: environment });
    assert.match(doctorHelp, /--check-token/);
    assert.match(doctorHelp, /--remote/);
    const doctor = run(process.execPath, [main, "doctor", "--check-token"], {
        env: { ...environment, BB_TOKEN: "package-smoke-token" },
    });
    assert.match(doctor, /\[OK\] Token readability:/);
    assert.match(doctor, /Summary: \d+ OK, \d+ WARN, 0 FAIL, \d+ SKIP/);
    assert.doesNotMatch(doctor, /package-smoke-token/);
    const invalidToken = run(
        process.execPath,
        [main, "doctor", "--check-token"],
        {
            env: { ...environment, BB_TOKEN: "" },
        },
        1,
    );
    assert.match(invalidToken, /\[FAIL\] Token readability:/);
    assert.match(invalidToken, /Summary: \d+ OK, \d+ WARN, 1 FAIL, \d+ SKIP/);
    assert.match(
        run(process.execPath, [main, "merge-pr", "--help"], { env: environment }),
        /--complete-tasks/,
    );
    assert.match(
        run(process.execPath, [main, "token", "status"], {
            env: { ...environment, BB_TOKEN: "package-smoke-token" },
        }),
        /Bitbucket token source: BB_TOKEN/,
    );
    assert.equal(
        run(process.execPath, [main, "config", "git.remote"], { env: environment }).trim(),
        "origin",
    );
    console.log("Checking repository discovery in the installed JavaScript...");
    run(process.execPath, [main, "config", "bitbucket.url", "https://bitbucket.example/context"], {
        env: environment,
    });
    run(process.execPath, [main, "config", "bitbucket.sshHostnames", "SSH-GATEWAY,ssh-gateway"], {
        env: environment,
    });
    const settings = run(process.execPath, [main, "config", "list"], { env: environment });
    assert.match(settings, /bitbucket.projectKey = <not configured>/);
    assert.match(settings, /bitbucket.sshHostnames = ssh-gateway/);
    for (const manual of [false, true]) {
        const repositoryCheck = `
            import assert from 'node:assert/strict';
            import cp from 'node:child_process';
            import { syncBuiltinESMExports } from 'node:module';
            let gitCalls = 0;
            let requests = 0;
            cp.spawnSync = (command, args) => {
                assert.equal(${manual}, false, 'Manual selection must not start processes.');
                assert.equal(command, 'git');
                assert.deepEqual(args, ['remote', 'get-url', '--', 'origin']);
                gitCalls++;
                return { status:0, stdout:'git@ssh-gateway:REMOTE/payments.git', stderr:'', signal:null };
            };
            syncBuiltinESMExports();
            const repository = { name:'Payments', slug:'payments', project:{ key:'REMOTE' } };
            const url = 'https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42';
            globalThis.fetch = async (input, init) => {
                requests++;
                assert.equal(String(input), 'https://bitbucket.example/context/rest/api/latest/projects/REMOTE/repos/payments/pull-requests?state=OPEN&start=0&limit=100');
                assert.equal(init.method, 'GET');
                assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer package-smoke-token');
                return Response.json({ size:1, limit:100, start:0, isLastPage:true, values:[{
                    id:42, version:0, state:'OPEN', reviewers:[],
                    fromRef:{ id:'refs/heads/feature/test', displayId:'feature/test', repository },
                    toRef:{ id:'refs/heads/develop', displayId:'develop', repository },
                    links:{ self:[{ href:url }] }
                }] });
            };
            await import(${JSON.stringify(pathToFileURL(main).href)});
            assert.equal(gitCalls, ${manual ? 0 : 1});
            assert.equal(requests, 1);
        `;
        const args = [main, "get-pr-url", "feature/test", "develop"];
        if (manual) args.push("--project-key", "REMOTE", "--repository", "payments");
        const result = run(
            process.execPath,
            ["--input-type=module", "--eval", repositoryCheck, ...args],
            {
                env: { ...environment, BB_TOKEN: "package-smoke-token" },
            },
        );
        assert.equal(
            result.trim(),
            "https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42",
        );
    }
    run(process.execPath, [main, "config", "bitbucket.sshHostnames", ""], { env: environment });
    assert.equal(
        run(process.execPath, [main, "config", "bitbucket.sshHostnames"], {
            env: environment,
        }).trim(),
        "",
    );
    console.log("Package contents, production-only installation, and CLI smoke checks passed.");
} finally {
    assert.equal(dirname(resolve(fixture)), temporaryRoot);
    rmSync(fixture, { recursive: true, force: true });
}
