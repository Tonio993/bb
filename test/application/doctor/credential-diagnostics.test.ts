import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { diagnoseCredentials } from "../../../src/application/doctor/credential-diagnostics.ts";
import { TokenStore } from "../../../src/auth/token-store.ts";
import { createTokenBackend } from "../../../src/auth/token-backends.ts";

function fixture(
    t: TestContext,
    token: string | undefined = "private-token",
    environment: NodeJS.ProcessEnv = {},
) {
    const read = t.mock.fn<() => string | undefined>(() => token);
    const unexpected = (): never => {
        throw new Error("Unexpected credential write.");
    };
    const tokenStore = new TokenStore(
        { name: "Test storage", tool: "test-tool", read, write: unexpected, delete: unexpected },
        environment,
    );
    const toolAvailable = t.mock.fn(() => true);
    return { dependencies: { tokenStore, toolAvailable }, read, toolAvailable };
}

test("remote readiness is explicit and requires a successfully inspected credential", (t) => {
    const { dependencies, read } = fixture(t);
    assert.equal(diagnoseCredentials(dependencies).readyForRemote, false);
    const inspected = diagnoseCredentials(dependencies, true);
    assert.equal(inspected.readyForRemote, true);
    assert.doesNotMatch(JSON.stringify(inspected), /private-token/);
    read.mock.mockImplementation(() => undefined);
    assert.equal(diagnoseCredentials(dependencies, true).readyForRemote, false);
});

test("default credential diagnostics inspect metadata without reading or validating a token", (t) => {
    const { dependencies, read, toolAvailable } = fixture(t);
    const results = diagnoseCredentials(dependencies).checks;
    assert.deepEqual(
        results.map((check) => check.status),
        ["OK", "OK", "SKIP"],
    );
    assert.match(results[0].message, /Test storage/);
    assert.equal(read.mock.callCount(), 0);
    assert.deepEqual(toolAvailable.mock.calls[0].arguments, ["test-tool"]);
    assert.doesNotMatch(JSON.stringify(results), /private-token/);
});

test("explicit token checks read once and do not retain credentials in the diagnostic result or cache", (t) => {
    const { dependencies, read } = fixture(t);
    const results = diagnoseCredentials(dependencies, true).checks;
    assert.equal(results.at(-1)!.status, "OK");
    assert.match(results.at(-1)!.message, /locally valid/);
    assert.equal(read.mock.callCount(), 1);
    assert.doesNotMatch(JSON.stringify(results), /private-token/);
    dependencies.tokenStore.get();
    assert.equal(read.mock.callCount(), 2);
});

test("an absent token is distinct from a failed storage read", (t) => {
    const { dependencies, read } = fixture(t);
    read.mock.mockImplementation(() => undefined);
    const missing = diagnoseCredentials(dependencies, true).checks.at(-1)!;
    assert.equal(missing.status, "FAIL");
    assert.match(missing.message, /No token is configured/);
    read.mock.mockImplementation(() => {
        throw new Error("private-secret-error");
    });
    const failed = diagnoseCredentials(dependencies, true).checks.at(-1)!;
    assert.equal(failed.status, "FAIL");
    assert.match(failed.message, /Unlock the credential store/);
    assert.doesNotMatch(failed.message, /private-secret-error/);
});

for (const checkToken of [false, true]) {
    test(`missing backend tools skip reads with check-token=${checkToken}`, (t) => {
        const { dependencies, read, toolAvailable } = fixture(t);
        toolAvailable.mock.mockImplementation(() => false);
        const results = diagnoseCredentials(dependencies, checkToken).checks;
        assert.equal(results[1].status, checkToken ? "FAIL" : "WARN");
        assert.equal(results[2].status, "SKIP");
        assert.equal(read.mock.callCount(), 0);
    });
}

test("tool lookup errors do not expose diagnostics or trigger storage reads", (t) => {
    const { dependencies, read, toolAvailable } = fixture(t);
    toolAvailable.mock.mockImplementation(() => {
        throw new Error("private-secret-error");
    });
    const results = diagnoseCredentials(dependencies, true).checks;
    assert.equal(results[1].status, "FAIL");
    assert.doesNotMatch(JSON.stringify(results), /private-secret-error/);
    assert.equal(read.mock.callCount(), 0);
});

for (const value of ["environment-token", "", "invalid token"]) {
    for (const checkToken of [false, true]) {
        test(`environment credentials bypass storage and tool lookup for ${JSON.stringify(value)} with check-token=${checkToken}`, (t) => {
            const { dependencies, read, toolAvailable } = fixture(t, "private-token", {
                BB_TOKEN: value,
            });
            const results = diagnoseCredentials(dependencies, checkToken).checks;
            assert.match(results[0].message, /BB_TOKEN/);
            assert.equal(
                results.at(-1)!.status,
                !checkToken ? "SKIP" : value === "environment-token" ? "OK" : "FAIL",
            );
            assert.equal(read.mock.callCount(), 0);
            assert.equal(toolAvailable.mock.callCount(), 0);
            assert.doesNotMatch(
                JSON.stringify(results),
                /environment-token|private-token|invalid token/,
            );
        });
    }
}

for (const checkToken of [false, true]) {
    test(`unsupported storage is reported without execution with check-token=${checkToken}`, (t) => {
        const execute = t.mock.fn((): never => {
            throw new Error("Unexpected process.");
        });
        const tokenStore = new TokenStore(
            createTokenBackend({ platform: "aix", environment: {}, execute }),
            {},
        );
        const results = diagnoseCredentials(
            {
                tokenStore,
                toolAvailable: () => {
                    throw new Error("Unexpected lookup.");
                },
            },
            checkToken,
        ).checks;
        assert.equal(results[0].status, checkToken ? "FAIL" : "WARN");
        assert.match(results[0].message, /unavailable on this platform/);
        assert.equal(execute.mock.callCount(), 0);
    });
}

test("environment credentials work on unsupported platforms without inspecting backend metadata", () => {
    const tokenStore = new TokenStore(createTokenBackend({ platform: "aix" }), {
        BB_TOKEN: "environment-token",
    });
    const results = diagnoseCredentials(
        {
            tokenStore,
            toolAvailable: () => {
                throw new Error("Unexpected lookup.");
            },
        },
        true,
    ).checks;
    assert.equal(results.at(-1)!.status, "OK");
});

for (const [platform, tool] of [
    ["win32", "powershell.exe"],
    ["darwin", "/usr/bin/security"],
    ["linux", "secret-tool"],
] as const) {
    test(`diagnostics reuse backend metadata on ${platform} without running native tools`, (t) => {
        const execute = t.mock.fn((): never => {
            throw new Error("Unexpected native process.");
        });
        const tokenStore = new TokenStore(
            createTokenBackend({ platform, environment: {}, execute }),
            {},
        );
        const lookup = t.mock.fn((command: string) => {
            assert.equal(command, tool);
            return true;
        });
        const results = diagnoseCredentials({ tokenStore, toolAvailable: lookup }).checks;
        assert.equal(results.at(-1)!.status, "SKIP");
        assert.equal(lookup.mock.callCount(), 1);
        assert.equal(execute.mock.callCount(), 0);
    });
}

for (const [platform, hint] of [
    ["win32", /Windows account that owns the token/],
    ["darwin", /login keychain/],
    ["linux", /secret-tool \(libsecret\).*Secret Service session/],
] as const) {
    test(`storage read failures provide platform-specific remediation on ${platform}`, () => {
        const store = new TokenStore(createTokenBackend({ platform, environment: {} }), {});
        const results = diagnoseCredentials(
            {
                tokenStore: {
                    describeSource: () => store.describeSource(),
                    inspectCredential: () => {
                        throw new Error("private-native-error");
                    },
                },
                toolAvailable: () => true,
            },
            true,
        ).checks;
        assert.equal(results.at(-1)!.status, "FAIL");
        assert.match(results.at(-1)!.message, hint);
        assert.doesNotMatch(JSON.stringify(results), /private-native-error/);
    });
}
