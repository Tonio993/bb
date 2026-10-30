import assert from "node:assert/strict";
import fs, { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { ConfigStore, getGlobalConfigPath } from "../src/config/config.ts";
import type { BbConfig, ConfigKey } from "../src/config/config.ts";

function createStore(t: TestContext): ConfigStore {
    const directory = mkdtempSync(join(tmpdir(), "bb-config-test-"));
    t.after(() => {
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        rmSync(directory, { recursive: true, force: true });
    });
    return new ConfigStore(join(directory, "config.json"));
}

test("missing configuration can be read without creating a file", (t) => {
    const store = createStore(t);

    assert.equal(store.get("bitbucket.url"), undefined);
    assert.equal(store.get("bitbucket.projectKey"), undefined);
    assert.deepEqual(store.get("bitbucket.defaultReviewers"), []);
    assert.equal(store.get("git.remote"), "origin");
    assert.equal(store.exists(), false);
});

test("required configuration errors explain how to configure each missing key", (t) => {
    const store = createStore(t);

    assert.throws(() => store.loadRequired(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Required configuration 'bitbucket.url' is missing/);
        assert.ok(error.message.includes('bb config bitbucket.url "https://bitbucket.company.com"'));
        assert.ok(error.message.includes("bb config init"));
        return true;
    });

    store.set("bitbucket.url", "https://bitbucket.company.com");
    assert.throws(() => store.loadRequired(), /bb config bitbucket.projectKey "PROJECT"/);
});

test("settings persist independently and normalize CLI values", (t) => {
    const store = createStore(t);
    store.set("bitbucket.url", " https://bitbucket.company.com/bitbucket/// ");
    store.set("bitbucket.projectKey", " PROJECT ");
    store.set("bitbucket.defaultReviewers", " mario, , luca, ");
    store.set("git.remote", " upstream ");

    const reloaded = new ConfigStore(store.path);
    assert.deepEqual(reloaded.loadRequired(), {
        bitbucket: {
            url: "https://bitbucket.company.com/bitbucket",
            projectKey: "PROJECT",
            defaultReviewers: ["mario", "luca"],
        },
        git: { remote: "upstream" },
    });

    reloaded.set("bitbucket.defaultReviewers", "");
    assert.deepEqual(reloaded.get("bitbucket.defaultReviewers"), []);
});

test("optional settings have defaults when required settings are present", (t) => {
    const store = createStore(t);
    store.set("bitbucket.url", "https://bitbucket.company.com");
    store.set("bitbucket.projectKey", "PROJECT");

    const config = store.loadRequired();
    assert.deepEqual(config.bitbucket.defaultReviewers, []);
    assert.equal(config.git.remote, "origin");
});

test("empty required settings are rejected without changing the file", (t) => {
    const store = createStore(t);
    store.set("bitbucket.url", "https://bitbucket.company.com");
    const original = readFileSync(store.path, "utf8");

    for (const key of ["bitbucket.url", "bitbucket.projectKey", "git.remote"] as const) {
        assert.throws(() => store.set(key, "  "), /cannot be empty/);
        assert.equal(readFileSync(store.path, "utf8"), original);
    }
});

test("saving a complete configuration creates the parent directory", (t) => {
    const parent = createStore(t);
    const store = new ConfigStore(join(parent.path, "nested", "config.json"));
    const config = {
        bitbucket: {
            url: "https://bitbucket.company.com",
            projectKey: "PROJECT",
            defaultReviewers: ["mario"],
        },
        git: { remote: "origin" },
    };

    store.save(config);
    assert.deepEqual(store.loadRequired(), config);
    assert.equal(existsSync(store.path), true);
});

test("invalid JSON reports the configuration path", (t) => {
    const store = createStore(t);
    writeFileSync(store.path, "{", "utf8");

    assert.throws(() => store.get("git.remote"), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(`Unable to read configuration file '${store.path}':`));
        return true;
    });
});

const invalidConfigurations: [unknown, string][] = [
    [null, "Configuration must be a JSON object."],
    [[], "Configuration must be a JSON object."],
    ["invalid", "Configuration must be a JSON object."],
    [{ bitbucket: null }, "Configuration section 'bitbucket' must be an object."],
    [{ bitbucket: [] }, "Configuration section 'bitbucket' must be an object."],
    [{ git: "origin" }, "Configuration section 'git' must be an object."],
    [{ bitbucket: { url: 123 } }, "Configuration 'bitbucket.url' must be a string."],
    [{ bitbucket: { projectKey: null } }, "Configuration 'bitbucket.projectKey' must be a string."],
    [{ git: { remote: false } }, "Configuration 'git.remote' must be a string."],
    [{ bitbucket: { defaultReviewers: "mario" } }, "Configuration 'bitbucket.defaultReviewers' must be an array of strings."],
    [{ bitbucket: { defaultReviewers: ["mario", null] } }, "Configuration 'bitbucket.defaultReviewers' must be an array of strings."],
];

for (const [config, message] of invalidConfigurations) {
    test(`invalid configuration ${JSON.stringify(config)} reports its field and preserves the file`, (t) => {
        const store = createStore(t);
        const content = JSON.stringify(config);
        writeFileSync(store.path, content, "utf8");

        for (const read of [() => store.get("git.remote"), () => store.loadRequired()]) {
            assert.throws(read, (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes(store.path));
                assert.ok(error.message.includes(message));
                return true;
            });
        }

        assert.throws(() => store.set("git.remote", "upstream"));
        assert.equal(readFileSync(store.path, "utf8"), content);
    });
}

test("updating a known setting preserves other configuration fields", (t) => {
    const store = createStore(t);
    writeFileSync(store.path, JSON.stringify({
        bitbucket: { projectKey: "PROJECT", futureSetting: true },
        futureSection: { enabled: true },
    }), "utf8");

    store.set("git.remote", "upstream");
    assert.deepEqual(JSON.parse(readFileSync(store.path, "utf8")), {
        bitbucket: { projectKey: "PROJECT", futureSetting: true },
        git: { remote: "upstream" },
        futureSection: { enabled: true },
    });
});

test("the global directory honors the platform configuration environment variable", {
    skip: process.platform === "darwin",
}, (t) => {
    const directory = join(homedir(), "bb-test-config-location");
    const variable = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
    const original = process.env[variable];
    t.after(() => {
        if (original === undefined) {
            delete process.env[variable];
        } else {
            process.env[variable] = original;
        }
    });

    process.env[variable] = directory;
    assert.equal(getGlobalConfigPath(), join(directory, "bb", "config.json"));
    assert.equal(new ConfigStore().path, join(directory, "bb", "config.json"));
});

const normalizedConfig: BbConfig = {
    bitbucket: { url: "https://bitbucket.company.com/bitbucket", projectKey: "PROJECT", defaultReviewers: ["mario", "luca"] },
    git: { remote: "upstream" },
};
const unnormalizedConfig = {
    bitbucket: { url: " HTTPS://BITBUCKET.company.com:443/bitbucket/// ", projectKey: " PROJECT ", defaultReviewers: [" mario ", " ", "luca"] },
    git: { remote: " upstream " },
};

test("save validates and normalizes complete configurations without modifying its input", (t) => {
    const store = createStore(t);
    const input = structuredClone(unnormalizedConfig);
    store.save(input);
    assert.deepEqual(input, unnormalizedConfig);
    assert.deepEqual(JSON.parse(readFileSync(store.path, "utf8")), normalizedConfig);
    assert.deepEqual(store.loadRequired(), normalizedConfig);
});

test("reads normalize hand-written configuration without rewriting the file", (t) => {
    const store = createStore(t);
    const content = JSON.stringify(unnormalizedConfig);
    writeFileSync(store.path, content);
    assert.equal(store.get("bitbucket.url"), normalizedConfig.bitbucket.url);
    assert.equal(store.get("bitbucket.projectKey"), "PROJECT");
    assert.deepEqual(store.get("bitbucket.defaultReviewers"), ["mario", "luca"]);
    assert.equal(store.get("git.remote"), "upstream");
    assert.deepEqual(store.loadRequired(), normalizedConfig);
    assert.equal(readFileSync(store.path, "utf8"), content);
});

test("snapshots use one read and remain independent from subsequent configuration updates", (t) => {
    const store = createStore(t);
    store.save(normalizedConfig);
    const nativeRead = fs.readFileSync;
    let reads = 0;
    const read = t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
        if (args[0] === store.path) reads++;
        return nativeRead(...args);
    });
    syncBuiltinESMExports();
    t.after(() => { read.mock.restore(); syncBuiltinESMExports(); });
    const snapshot = store.snapshot();
    assert.equal(reads, 1);
    assert.deepEqual(snapshot, {
        "bitbucket.url": normalizedConfig.bitbucket.url, "bitbucket.projectKey": "PROJECT",
        "bitbucket.defaultReviewers": ["mario", "luca"], "git.remote": "upstream",
    });
    store.set("git.remote", "origin");
    assert.equal(snapshot["git.remote"], "upstream");
    assert.equal(store.snapshot()["git.remote"], "origin");
});

for (const url of [
    "not a URL", "ftp://bitbucket.company.com", "https:/bitbucket.company.com", "https://user:private-password@bitbucket.company.com",
    "https://*.company.com", "https://bitbucket.company.com?query=1", "https://bitbucket.company.com#fragment",
    "https://bitbucket.company.com/?", "https://bitbucket.company.com/#", "https://bitbucket.company.com/bit bucket",
]) {
    test(`all configuration entry points reject unsafe or invalid URL ${JSON.stringify(url)}`, (t) => {
        const store = createStore(t);
        store.save(normalizedConfig);
        const original = readFileSync(store.path, "utf8");
        const invalid = { ...normalizedConfig, bitbucket: { ...normalizedConfig.bitbucket, url } };
        for (const write of [() => store.set("bitbucket.url", url), () => store.save(invalid)]) {
            assert.throws(write, (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /Invalid Bitbucket URL/);
                assert.ok(!error.message.includes("private-password"));
                return true;
            });
            assert.equal(readFileSync(store.path, "utf8"), original);
        }
        writeFileSync(store.path, JSON.stringify(invalid));
        for (const read of [() => store.get("bitbucket.url"), () => store.snapshot(), () => store.loadRequired()]) {
            assert.throws(read, /Invalid Bitbucket URL/);
        }
        assert.equal(store.get("git.remote"), "upstream");
        store.set("bitbucket.url", normalizedConfig.bitbucket.url);
        assert.deepEqual(store.loadRequired(), normalizedConfig);
    });
}

test("save rejects missing required keys and runtime schema errors before changing the file", (t) => {
    const store = createStore(t);
    store.save(normalizedConfig);
    const original = readFileSync(store.path, "utf8");
    for (const value of [{}, { bitbucket: { url: normalizedConfig.bitbucket.url } }, { bitbucket: { url: 42 } }, { git: { remote: " " } }]) {
        assert.throws(() => store.save(value as unknown as BbConfig));
        assert.equal(readFileSync(store.path, "utf8"), original);
        assert.deepEqual(readdirSync(dirname(store.path)), ["config.json"]);
    }
});

const emptySettings: { key: ConfigKey; config: BbConfig }[] = [
    { key: "bitbucket.url", config: { ...normalizedConfig, bitbucket: { ...normalizedConfig.bitbucket, url: " " } } },
    { key: "bitbucket.projectKey", config: { ...normalizedConfig, bitbucket: { ...normalizedConfig.bitbucket, projectKey: " " } } },
    { key: "git.remote", config: { ...normalizedConfig, git: { remote: " " } } },
];
for (const { key, config } of emptySettings) {
    test(`an explicitly empty ${key} is rejected consistently in reads and complete saves`, (t) => {
        const store = createStore(t);
        store.save(normalizedConfig);
        const original = readFileSync(store.path, "utf8");
        assert.throws(() => store.save(config), /cannot be empty/);
        assert.equal(readFileSync(store.path, "utf8"), original);
        writeFileSync(store.path, JSON.stringify(config));
        for (const read of [() => store.get(key), () => store.snapshot(), () => store.loadRequired()]) {
            assert.throws(read, /cannot be empty/);
        }
    });
}

test("failed writes leave the old configuration intact and remove partial temporary files", (t) => {
    const store = createStore(t);
    store.save(normalizedConfig);
    const original = readFileSync(store.path, "utf8");
    const nativeWrite = fs.writeFileSync;
    const write = t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
        nativeWrite(args[0], "partial", args[2]);
        throw new Error("Simulated write failure.");
    });
    syncBuiltinESMExports();
    t.after(() => { write.mock.restore(); syncBuiltinESMExports(); });
    assert.throws(() => store.set("git.remote", "origin"), /Unable to write configuration file.*Simulated write failure/);
    assert.equal(readFileSync(store.path, "utf8"), original);
    assert.deepEqual(readdirSync(dirname(store.path)), ["config.json"]);
});

test("failed replacement leaves the old configuration intact and removes the completed temporary file", (t) => {
    const store = createStore(t);
    store.save(normalizedConfig);
    const original = readFileSync(store.path, "utf8");
    const rename = t.mock.method(fs, "renameSync", () => { throw new Error("Simulated replacement failure."); });
    syncBuiltinESMExports();
    t.after(() => { rename.mock.restore(); syncBuiltinESMExports(); });
    assert.throws(() => store.set("git.remote", "origin"), /Unable to write configuration file.*Simulated replacement failure/);
    assert.equal(readFileSync(store.path, "utf8"), original);
    assert.deepEqual(readdirSync(dirname(store.path)), ["config.json"]);
});
