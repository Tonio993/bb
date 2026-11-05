import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
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
        [...expectedRuntime, "README.md", "docs/json-output.md", "package.json"].sort(),
        "The package must contain only runtime JavaScript, its manifest, README, JSON contract, and bundled Commander.",
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
    assert.equal(
        readFileSync(join(installedPackage, "docs", "json-output.md"), "utf8"),
        readFileSync(join(projectRoot, "docs", "json-output.md"), "utf8"),
    );
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
        assert.match(commandHelp, /--json/);
        if (command === "merge-pr") assert.match(commandHelp, /--delete-source/);
    }
    const doctorHelp = run(process.execPath, [main, "doctor", "--help"], { env: environment });
    assert.match(doctorHelp, /--check-token/);
    assert.match(doctorHelp, /--remote/);
    assert.match(doctorHelp, /--json/);
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
    for (const validToken of [false, true]) {
        const raw = run(
            process.execPath,
            [main, "--json", "doctor", "--check-token"],
            {
                env: { ...environment, BB_TOKEN: validToken ? "package-smoke-token" : "" },
            },
            validToken ? 0 : 1,
        );
        const result = JSON.parse(raw);
        assert.equal(result.schemaVersion, 1);
        assert.equal(result.command, "doctor");
        assert.equal(result.ok, validToken);
        assert.equal(result.exitCode, validToken ? 0 : 1);
        assert.ok(Array.isArray(result.data.checks));
        assert.equal(result.error?.code ?? null, validToken ? null : "DIAGNOSTIC_FAILED");
        assert.doesNotMatch(raw, /package-smoke-token/);
    }
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
        for (const json of [false, true]) {
            const invocation = json ? [main, "--json", ...args.slice(1)] : args;
            const result = run(
                process.execPath,
                ["--input-type=module", "--eval", repositoryCheck, ...invocation],
                {
                    env: { ...environment, BB_TOKEN: "package-smoke-token" },
                },
            );
            const url =
                "https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42";
            if (json) {
                const payload = JSON.parse(result);
                assert.equal(payload.schemaVersion, 1);
                assert.equal(payload.ok, true);
                assert.equal(payload.command, "get-pr-url");
                assert.equal(payload.data.pullRequest.url, url);
            } else assert.equal(result.trim(), url);
        }
    }
    run(process.execPath, [main, "config", "bitbucket.sshHostnames", ""], { env: environment });
    assert.equal(
        run(process.execPath, [main, "config", "bitbucket.sshHostnames"], {
            env: environment,
        }).trim(),
        "",
    );
    console.log("Checking Pull Request consultation in the installed JavaScript...");
    for (const { command, blocked } of [
        { command: "list", blocked: false },
        { command: "show", blocked: false },
        { command: "checks", blocked: false },
        { command: "checks", blocked: true },
    ]) {
        for (const json of [false, true]) {
            const consultationCheck = [
                "import assert from 'node:assert/strict';",
                "import cp from 'node:child_process';",
                "import { syncBuiltinESMExports } from 'node:module';",
                "cp.spawnSync = () => { throw new Error('Explicit consultation must not start Git.'); };",
                "syncBuiltinESMExports();",
                "const repository = { name:'Payments', slug:'payments', project:{ key:'REMOTE' } };",
                "const pr = { id:42, version:7, state:'OPEN', title:'Inspect payments',",
                "author:{ user:{ name:'jane', displayName:'Jane', emailAddress:'private-marker' } },",
                "reviewers:[{ status:'APPROVED', user:{ name:'john' } }],",
                "fromRef:{ id:'refs/heads/feature/test', displayId:'feature/test', repository },",
                "toRef:{ id:'refs/heads/develop', displayId:'develop', repository },",
                "links:{ self:[{ href:'https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42' }] } };",
                "const root = 'https://bitbucket.example/context/rest/api/latest/projects/REMOTE/repos/payments/pull-requests';",
                "const paths = [" +
                    JSON.stringify(command === "list" ? "?state=OPEN&start=0&limit=100" : "/42") +
                    ", '/42/blocker-comments?start=0&limit=100', '/42/merge'];",
                "let calls = 0;",
                "globalThis.fetch = async (input, init) => {",
                "assert.equal(String(input), root + paths[calls]);",
                "assert.equal(init.method, 'GET');",
                "assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer package-smoke-token');",
                "calls++;",
                "if (calls === 3) return Response.json({ canMerge:" +
                    !blocked +
                    ", conflicted:false, outcome:'CLEAN', vetoes:" +
                    (blocked
                        ? "[{ summaryMessage:'CI required', detailedMessage:'Wait for CI' }]"
                        : "[]") +
                    " });",
                "const page = values => ({ size:values.length, limit:100, start:0, isLastPage:true, values });",
                "return Response.json(calls === 1 ? (" +
                    JSON.stringify(command) +
                    " === 'list' ? page([pr]) : pr) : page([",
                "{ id:101, version:0, state:'OPEN', severity:'BLOCKER', text:'Fix validation' } ])); };",
                "await import(" + JSON.stringify(pathToFileURL(main).href) + ");",
                "assert.equal(calls, " + (command === "checks" ? 3 : 2) + ");",
            ].join("\n");
            const args = [main, ...(json ? ["--json"] : []), "pr", command];
            if (command === "list")
                args.push("--project-key", "REMOTE", "--repository", "payments");
            else
                args.push(
                    "https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42",
                );
            const result = run(
                process.execPath,
                ["--input-type=module", "--eval", consultationCheck, ...args],
                {
                    env: { ...environment, BB_TOKEN: "package-smoke-token" },
                },
                blocked ? 1 : 0,
            );
            assert.doesNotMatch(result, /private-marker|package-smoke-token/);
            if (json) {
                const payload = JSON.parse(result);
                assert.equal(payload.command, "pr " + command);
                assert.equal(payload.ok, !blocked);
                if (command === "checks") {
                    assert.equal(payload.data.readyForMerge, !blocked);
                    assert.equal(payload.error?.code, blocked ? "MERGE_CHECK_FAILED" : undefined);
                }
                const pr =
                    command === "list" ? payload.data.pullRequests[0] : payload.data.pullRequest;
                assert.equal(pr.title, "Inspect payments");
                assert.equal(pr.author.name, "jane");
                assert.deepEqual(pr.openTasks, [{ id: 101, text: "Fix validation" }]);
            } else {
                assert.match(result, /#42 OPEN - Inspect payments/);
                assert.match(result, /#101 Fix validation/);
                if (command === "checks")
                    assert.match(
                        result,
                        blocked ? /Not ready for merge/ : /Ready for merge at the time/,
                    );
            }
        }
    }
    console.log("Checking creation previews in the installed JavaScript...");
    const templatePath = join(fixture, "pr-template.md");
    writeFileSync(templatePath, "# {{title}}\n{{commits}}");
    run(process.execPath, [main, "config", "bitbucket.descriptionTemplate", templatePath], {
        env: environment,
    });
    assert.equal(
        run(process.execPath, [main, "config", "bitbucket.descriptionTemplate"], {
            env: environment,
        }).trim(),
        templatePath,
    );
    for (const mode of ["preview", "created", "existing", "browser-failed"]) {
        for (const json of [false, true]) {
            const createPreviewCheck = [
                "import assert from 'node:assert/strict';",
                "import cp from 'node:child_process';",
                "import { syncBuiltinESMExports } from 'node:module';",
                "const calls = [];",
                "const mode = " + JSON.stringify(mode) + ";",
                "let searches = 0; let writes = 0;",
                "cp.execFile = (_command, _args, _options, callback) => callback(new Error('Browser unavailable.'));",
                "cp.spawnSync = (command, args) => {",
                "assert.equal(command, 'git'); calls.push(args[0]);",
                "assert.ok(['fetch','show-ref','log'].includes(args[0]));",
                "return { status:0, stdout:args[0] === 'log' ? 'Validate payments\\x1eCheck account\\x1d' : '', stderr:'', signal:null }; };",
                "syncBuiltinESMExports();",
                "const repository = { name:'Payments', slug:'payments', project:{ key:'REMOTE' } };",
                "const pr = { id:42, version:0, state:'OPEN', reviewers:[], fromRef:{ id:'refs/heads/feature/test', displayId:'feature/test', repository }, toRef:{ id:'refs/heads/develop', displayId:'develop', repository }, links:{ self:[{ href:'https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42' }] } };",
                "globalThis.fetch = async (_input, init) => {",
                "assert.notEqual(mode, 'preview', 'Creation preview must not use REST.');",
                "if (init.method === 'GET') { searches++; const values = mode === 'existing' ? [pr] : []; return Response.json({ values, size:values.length, start:0, limit:100, isLastPage:true }); }",
                "assert.equal(init.method, 'POST'); assert.notEqual(mode, 'existing'); writes++;",
                "assert.equal(JSON.parse(init.body).description, '# Validate payments\\n* Validate payments\\n    * Check account');",
                "return Response.json(pr, { status:201 }); };",
                "await import(" + JSON.stringify(pathToFileURL(main).href) + ");",
                "assert.deepEqual(calls, ['fetch','show-ref','show-ref','log']);",
                "assert.equal(searches, mode === 'preview' ? 0 : 1);",
                "assert.equal(writes, mode === 'preview' || mode === 'existing' ? 0 : 1);",
            ].join("\n");
            const raw = run(
                process.execPath,
                [
                    "--input-type=module",
                    "--eval",
                    createPreviewCheck,
                    main,
                    ...(json ? ["--json"] : []),
                    "create-pr",
                    "feature/test",
                    "develop",
                    "--project-key",
                    "REMOTE",
                    "--repository",
                    "payments",
                    ...(mode === "preview"
                        ? ["--dry-run", "--open"]
                        : mode === "browser-failed"
                          ? ["--open"]
                          : []),
                    "--reviewer",
                    "jane",
                ],
                { env: { ...environment, BB_TOKEN: "package-smoke-token" } },
                mode === "browser-failed" ? 1 : 0,
            );
            assert.doesNotMatch(raw, /package-smoke-token/);
            if (json) {
                const result = JSON.parse(raw);
                assert.equal(result.ok, mode !== "browser-failed");
                if (mode !== "preview") {
                    assert.equal(result.data.created, mode !== "existing");
                    assert.equal(result.data.pullRequest.id, 42);
                    assert.equal(
                        result.data.browser,
                        mode === "browser-failed" ? "failed" : "not-requested",
                    );
                    assert.equal(
                        result.error?.code,
                        mode === "browser-failed" ? "BROWSER_OPEN_FAILED" : undefined,
                    );
                } else {
                    assert.equal(result.data.dryRun, true);
                    assert.equal(result.data.plan.title, "Validate payments");
                    assert.deepEqual(result.data.plan.reviewers, ["jane"]);
                    assert.equal(result.data.git.fetchPerformed, true);
                    assert.match(result.data.plan.description, /# Validate payments/);
                }
            } else if (mode === "preview")
                assert.match(raw, /Dry run: no Pull Request was created/);
            else if (mode === "existing") assert.match(raw, /Existing Pull Request:/);
            else assert.match(raw, /pull-requests\/42/);
        }
    }
    run(process.execPath, [main, "config", "bitbucket.descriptionTemplate", ""], {
        env: environment,
    });
    console.log("Checking source deletion after merge in the installed JavaScript...");
    for (const outcome of [
        "deleted",
        "deletion-rejected",
        "merge-rejected",
        "unconfirmed-merge",
        "preview",
    ]) {
        const mergeCheck = `
            import assert from 'node:assert/strict';
            import cp from 'node:child_process';
            import { syncBuiltinESMExports } from 'node:module';
            cp.spawnSync = () => { throw new Error('Manual merge must not start processes.'); };
            syncBuiltinESMExports();
            const outcome = ${JSON.stringify(outcome)};
            const requests = [];
            const target = { name:'Payments', slug:'payments', project:{ key:'REMOTE' } };
            const source = { name:'Fork', slug:'fork-payments', project:{ key:'FORK' } };
            const commit = 'a'.repeat(40);
            const pr = {
                id:42, version:7, state:'OPEN', reviewers:[],
                fromRef:{ id:'refs/heads/feature/test', displayId:'feature/test', latestCommit:commit, repository:source },
                toRef:{ id:'refs/heads/develop', displayId:'develop', repository:target },
                links:{ self:[{ href:'https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42' }] }
            };
            globalThis.fetch = async (input, init) => {
                const path = new URL(String(input)).pathname;
                const method = init.method;
                requests.push(method);
                assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer package-smoke-token');
                if (method === 'GET' && path.endsWith('/pull-requests')) {
                    return Response.json({ values:[pr], size:1, start:0, limit:100, isLastPage:true });
                }
                if (method === 'GET' && path.endsWith('/pull-requests/42')) return Response.json(pr);
                if (outcome === 'preview') {
                    assert.equal(method, 'GET', 'Preview must never write to REST.');
                    if (path.endsWith('/blocker-comments')) return Response.json({
                        values:[{ id:101, version:2, state:'OPEN', severity:'BLOCKER' }],
                        size:1, start:0, limit:100, isLastPage:true
                    });
                    if (path.endsWith('/comments/101')) return Response.json({ id:101, version:3, state:'OPEN', severity:'BLOCKER', text:'Fix tests' });
                    assert.ok(path.endsWith('/commit-message-suggestion'));
                    return Response.json({ title:'Merge payments', body:'Reviewed changes' });
                }
                if (method === 'POST') {
                    assert.equal(path, '/context/rest/api/latest/projects/REMOTE/repos/payments/pull-requests/42/merge');
                    assert.deepEqual(JSON.parse(init.body), { version:7 });
                    return outcome === 'merge-rejected'
                        ? Response.json({ errors:[{ message:'Merge rejected.' }] }, { status:409 })
                        : Response.json({ ...pr, state:outcome === 'unconfirmed-merge' ? 'OPEN' : 'MERGED' });
                }
                assert.equal(method, 'DELETE');
                assert.equal(path, '/context/rest/branch-utils/latest/projects/FORK/repos/fork-payments/branches');
                assert.deepEqual(JSON.parse(init.body), { name:'refs/heads/feature/test', endPoint:commit, dryRun:false });
                return outcome === 'deletion-rejected'
                    ? Response.json({ errors:[{ message:'Protected branch.' }] }, { status:403 })
                    : new Response(null, { status:204 });
            };
            await import(${JSON.stringify(pathToFileURL(main).href)});
            assert.deepEqual(requests, outcome === 'preview' ? ['GET','GET','GET','GET','GET'] : outcome === 'merge-rejected' || outcome === 'unconfirmed-merge'
                ? ['GET','GET','POST'] : ['GET','GET','POST','DELETE']);
        `;
        for (const json of [false, true]) {
            const result = spawnSync(
                process.execPath,
                [
                    "--input-type=module",
                    "--eval",
                    mergeCheck,
                    main,
                    ...(json ? ["--json"] : []),
                    "merge-pr",
                    "feature/test",
                    "develop",
                    "--project-key",
                    "REMOTE",
                    "--repository",
                    "payments",
                    "--delete-source",
                    ...(outcome === "preview"
                        ? ["--dry-run", "--complete-tasks", "--message-prefix", "[TEST] "]
                        : []),
                ],
                {
                    cwd: fixture,
                    env: { ...environment, BB_TOKEN: "package-smoke-token" },
                    encoding: "utf8",
                    windowsHide: true,
                    timeout: 15000,
                },
            );
            assert.ifError(result.error);
            assert.equal(
                result.status,
                outcome === "deleted" || outcome === "preview" ? 0 : 1,
                result.stderr,
            );
            assert.doesNotMatch(
                result.stderr + result.stdout,
                /package-smoke-token|AssertionError/,
            );
            if (json) {
                assert.equal(result.stderr, "");
                const payload = JSON.parse(result.stdout);
                assert.equal(payload.schemaVersion, 1);
                assert.equal(payload.command, "merge-pr");
                assert.equal(payload.ok, outcome === "deleted" || outcome === "preview");
                assert.equal(payload.exitCode, result.status);
                assert.doesNotMatch(result.stdout, /Protected branch|Merge rejected/);
                if (outcome === "preview") {
                    assert.equal(payload.data.dryRun, true);
                    assert.equal(payload.data.pullRequest.state, "OPEN");
                    assert.deepEqual(payload.data.plan.tasksToComplete, [
                        { id: 101, version: 3, text: "Fix tests" },
                    ]);
                    assert.equal(
                        payload.data.plan.message,
                        "[TEST] Merge payments\n\nReviewed changes",
                    );
                    assert.equal(payload.data.plan.sourceDeletion.projectKey, "FORK");
                    assert.equal(payload.data.sourceDeletion, undefined);
                } else if (outcome === "deleted" || outcome === "deletion-rejected") {
                    assert.equal(payload.data.pullRequest.state, "MERGED");
                    assert.equal(
                        payload.data.sourceDeletion,
                        outcome === "deleted" ? "deleted" : "failed",
                    );
                    assert.equal(
                        payload.error?.code ?? null,
                        outcome === "deleted" ? null : "SOURCE_DELETION_FAILED",
                    );
                } else {
                    assert.equal(payload.data, null);
                    assert.equal(
                        payload.error.code,
                        outcome === "merge-rejected" ? "CONFLICT" : "APPLICATION_ERROR",
                    );
                }
            } else if (outcome === "preview") {
                assert.equal(result.stderr, "");
                assert.match(result.stdout, /Dry run: no tasks were completed/);
                assert.match(
                    result.stdout,
                    /Delete source after confirmed merge: FORK\/fork-payments/,
                );
            } else if (outcome === "merge-rejected" || outcome === "unconfirmed-merge") {
                assert.equal(result.stdout, "");
                assert.match(result.stderr, /Error:/);
            } else {
                assert.equal(
                    result.stdout.trim(),
                    "https://bitbucket.example/context/projects/REMOTE/repos/payments/pull-requests/42",
                );
                if (outcome === "deleted") assert.equal(result.stderr, "");
                else
                    assert.match(
                        result.stderr,
                        /was merged, but source branch deletion failed or could not be confirmed/,
                    );
            }
        }
    }
    console.log("Package contents, production-only installation, and CLI smoke checks passed.");
} finally {
    assert.equal(dirname(resolve(fixture)), temporaryRoot);
    rmSync(fixture, { recursive: true, force: true });
}
