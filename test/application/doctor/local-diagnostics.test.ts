import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { diagnoseLocalEnvironment } from "../../../src/application/doctor/local-diagnostics.ts";
import { ConfigStore } from "../../../src/config/config-store.ts";

function fixture(t: TestContext) {
    const directory = mkdtempSync(join(tmpdir(), "bb-doctor-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return {
        nodeVersion: "24.21.0",
        npmVersion: () => "12.2.1",
        gitVersion: () => "git version 2.50.1.windows.1",
        configStore: new ConfigStore(join(directory, "config.json")),
    };
}

test("doctor works before configuration init without creating a configuration file", (t) => {
    const dependencies = fixture(t);
    const results = diagnoseLocalEnvironment(dependencies).checks;
    assert.deepEqual(
        results.map((check) => check.status),
        ["OK", "OK", "OK", "OK", "WARN"],
    );
    assert.match(results.at(-1)!.message, /bb config init/);
    assert.equal(dependencies.configStore.exists(), false);
    assert.equal(results[3].message, dependencies.configStore.path);
});

test("doctor validates one snapshot without displaying configuration values", (t) => {
    const dependencies = fixture(t);
    dependencies.configStore.save({
        bitbucket: {
            url: "https://private.example.invalid",
            projectKey: "PRIVATE",
            defaultReviewers: [],
            sshHostnames: [],
        },
        git: { remote: "origin" },
    });
    const snapshot = t.mock.method(dependencies.configStore, "snapshot");
    const results = diagnoseLocalEnvironment(dependencies).checks;
    assert.ok(results.every((check) => check.status === "OK"));
    assert.equal(snapshot.mock.callCount(), 1);
    assert.doesNotMatch(JSON.stringify(results), /private\.example|PRIVATE/);
});

test("doctor reports all missing required settings together", (t) => {
    const dependencies = fixture(t);
    writeFileSync(dependencies.configStore.path, "{}");
    const result = diagnoseLocalEnvironment(dependencies).checks.at(-1)!;
    assert.equal(result.status, "WARN");
    assert.match(result.message, /bitbucket.url/);
    assert.doesNotMatch(result.message, /bitbucket.projectKey/);
});

test("doctor accepts a configuration without a default project", (t) => {
    const dependencies = fixture(t);
    dependencies.configStore.set("bitbucket.url", "https://example.invalid");
    const result = diagnoseLocalEnvironment(dependencies).checks.at(-1)!;
    assert.equal(result.status, "OK");
});

for (const content of [
    "{secret-marker",
    '{"git":{"remote":42}}',
    '{"bitbucket":{"url":"secret-marker"}}',
]) {
    test(`doctor safely reports malformed or invalid configuration: ${content}`, (t) => {
        const dependencies = fixture(t);
        writeFileSync(dependencies.configStore.path, content);
        const results = diagnoseLocalEnvironment(dependencies).checks;
        assert.equal(results.at(-1)!.status, "FAIL");
        assert.doesNotMatch(JSON.stringify(results), /secret-marker/);
        assert.equal(results.find((check) => check.name === "Git")!.status, "OK");
    });
}

test("doctor reports a configuration path that cannot be read as a file", (t) => {
    const dependencies = fixture(t);
    mkdirSync(dependencies.configStore.path);
    assert.equal(diagnoseLocalEnvironment(dependencies).checks.at(-1)!.status, "FAIL");
});

test("doctor continues after tool failures and never displays native error output", (t) => {
    const dependencies = fixture(t);
    const results = diagnoseLocalEnvironment({
        ...dependencies,
        nodeVersion: "22.0.0",
        npmVersion: () => {
            throw new Error("secret-marker");
        },
        gitVersion: () => {
            throw new Error("secret-marker");
        },
    }).checks;
    assert.deepEqual(
        results.map((check) => check.status),
        ["FAIL", "FAIL", "FAIL", "OK", "WARN"],
    );
    assert.doesNotMatch(JSON.stringify(results), /secret-marker/);
});

for (const version of ["11.19.0", "12.2.0", "12.1.9"]) {
    test(`doctor warns for npm ${version} without declaring the runtime unusable`, (t) => {
        const results = diagnoseLocalEnvironment({
            ...fixture(t),
            npmVersion: () => version,
        }).checks;
        assert.equal(results[0].status, "OK");
        assert.equal(results[1].status, "WARN");
        assert.match(results[1].message, /npm >=12.2.1/);
    });
}

for (const version of ["12.2.1", "12.3.0", "13.0.0"]) {
    test(`doctor accepts npm ${version}`, (t) => {
        assert.equal(
            diagnoseLocalEnvironment({ ...fixture(t), npmVersion: () => version }).checks[1].status,
            "OK",
        );
    });
}

test("doctor warns when Node supports the CLI but is too old for npm 12", (t) => {
    const results = diagnoseLocalEnvironment({ ...fixture(t), nodeVersion: "24.14.0" }).checks;
    assert.equal(results[0].status, "OK");
    assert.equal(results[1].status, "WARN");
});

test("doctor rejects unexpected tool output without echoing it", (t) => {
    const results = diagnoseLocalEnvironment({
        ...fixture(t),
        npmVersion: () => "secret-marker",
        gitVersion: () => "secret-marker",
    }).checks;
    assert.equal(results[1].status, "FAIL");
    assert.equal(results[2].status, "FAIL");
    assert.doesNotMatch(JSON.stringify(results), /secret-marker/);
});
