import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBitbucketRemoteUrl } from "../../src/repository/remote-url.ts";
import type { ParsedBitbucketRemote } from "../../src/repository/remote-url-types.ts";

const expected: ParsedBitbucketRemote = {
    protocol: "https",
    hostname: "bitbucket.example",
    port: undefined,
    contextPath: "",
    projectKey: "PROJECT",
    repository: "payments",
};

for (const [url, overrides] of [
    ["https://bitbucket.example/scm/PROJECT/payments.git", {}],
    ["http://bitbucket.example/scm/PROJECT/payments", { protocol: "http" }],
    ["https://BITBUCKET.example:443/scm/PROJECT/payments.git/", {}],
    ["http://bitbucket.example:80/scm/PROJECT/payments.git", { protocol: "http" }],
    [
        "https://bitbucket.example:8443/bitbucket/scm/PROJECT/payments.git",
        { port: 8443, contextPath: "/bitbucket" },
    ],
    [
        "https://bitbucket.example/services/bitbucket/scm/PROJECT/payments.git",
        { contextPath: "/services/bitbucket" },
    ],
    ["ssh://git@bitbucket.example:7999/PROJECT/payments.git", { protocol: "ssh", port: 7999 }],
    ["ssh://bitbucket.example/PROJECT/payments", { protocol: "ssh" }],
    [
        "ssh://git@BITBUCKET.example:22/upstream/PROJECT/payments.git",
        { protocol: "ssh", port: 22, contextPath: "/upstream" },
    ],
    ["git@bitbucket.example:PROJECT/payments.git", { protocol: "ssh" }],
    ["bitbucket.example:/PROJECT/payments.git/", { protocol: "ssh" }],
    [
        "git@bitbucket.example:upstream/PROJECT/payments.git",
        { protocol: "ssh", contextPath: "/upstream" },
    ],
    ["git@bitbucket.example:7999/PROJECT/payments.git", { protocol: "ssh", contextPath: "/7999" }],
    ["git@bitbucket-alias:PROJECT/payments.git", { protocol: "ssh", hostname: "bitbucket-alias" }],
    [
        "https://[2001:db8::1]:8443/scm/PROJECT/payments.git",
        { hostname: "[2001:db8::1]", port: 8443 },
    ],
    [
        "ssh://git@[2001:db8::1]:7999/PROJECT/payments.git",
        { protocol: "ssh", hostname: "[2001:db8::1]", port: 7999 },
    ],
    ["git@[2001:db8::1]:PROJECT/payments.git", { protocol: "ssh", hostname: "[2001:db8::1]" }],
    ["https://bitbucket.example/scm/~jane.doe/payments.git", { projectKey: "~jane.doe" }],
    ["git@bitbucket.example:~jane.doe/payments.git", { protocol: "ssh", projectKey: "~jane.doe" }],
    [
        "https://bitbucket.example/%62itbucket/scm/%50ROJECT/payments.git",
        { contextPath: "/bitbucket" },
    ],
    [
        "https://bitbucket.example/scm/Mixed_Project/Payments.API.git",
        { projectKey: "Mixed_Project", repository: "Payments.API" },
    ],
    ["https://bitbucket.example/scm/PROJECT/payments.git.git", { repository: "payments.git" }],
    ["  https://bitbucket.example/scm/PROJECT/payments.git  ", {}],
] satisfies [string, Partial<ParsedBitbucketRemote>][]) {
    test(`parse remote ${url}`, () => {
        assert.deepEqual(parseBitbucketRemoteUrl(url), { ...expected, ...overrides });
    });
}

test("remote credentials are discarded from the parsed result", () => {
    for (const url of [
        "https://private-user:private-token@bitbucket.example/scm/PROJECT/payments.git",
        "ssh://private-user:private-token@bitbucket.example/PROJECT/payments.git",
    ]) {
        const parsed = parseBitbucketRemoteUrl(url);
        assert.equal(parsed.projectKey, "PROJECT");
        assert.equal(parsed.repository, "payments");
        assert.doesNotMatch(JSON.stringify(parsed), /private-user|private-token/);
    }
});

for (const url of [
    "",
    " ",
    "not-a-url",
    "/local/PROJECT/payments.git",
    "../PROJECT/payments.git",
    "C:/PROJECT/payments.git",
    "C:\\PROJECT\\payments.git",
    "\\\\server\\PROJECT\\payments.git",
    "file:///PROJECT/payments.git",
    "git://bitbucket.example/PROJECT/payments.git",
    "ftp://bitbucket.example/scm/PROJECT/payments.git",
    "ext::ssh private-token",
    "https:////bitbucket.example/scm/PROJECT/payments.git",
    "https://bitbucket.example/PROJECT/payments.git",
    "https://bitbucket.example/projects/PROJECT/repos/payments/browse",
    "https://bitbucket.example/scm/PROJECT",
    "https://bitbucket.example/scm/PROJECT/.git",
    "https://bitbucket.example/scm//payments.git",
    "https://bitbucket.example/scm/PROJECT/payments.git//",
    "https://bitbucket.example/scm/PROJECT/payments.git?token=private-token",
    "https://bitbucket.example/scm/PROJECT/payments.git#private-token",
    "https://bitbucket.example:65536/scm/PROJECT/payments.git",
    "ssh://git@bitbucket.example:0/PROJECT/payments.git",
    "ssh://git@bitbucket.example:invalid/PROJECT/payments.git",
    "git@bitbucket.example:7999:PROJECT/payments.git",
    "https://bitbucket.example/scm/PROJECT/pay ments.git",
    "https://bitbucket.example/scm/PROJECT/pay%20ments.git",
    "https://bitbucket.example/scm/PROJECT/pay%00ments.git",
    "https://bitbucket.example/scm/PROJECT/pay%ZZments.git",
    "https://bitbucket.example/scm/PROJECT/pay%2Fments.git",
    "https://bitbucket.example/scm/PROJECT/pay%5Cments.git",
    "https://bitbucket.example/scm/PROJECT/%252Fpayments.git",
    "https://bitbucket.example/scm/PROJECT/../payments.git",
    "https://bitbucket.example/scm/PROJECT/%2e%2e/payments.git",
    "https://bitbucket.example/a/../scm/PROJECT/payments.git",
    "ssh://git@bitbucket.example/PROJECT/../PROJECT/payments.git",
    "git@bitbucket.example:../PROJECT/payments.git",
    "https://*.example/scm/PROJECT/payments.git",
    "https://bitbucket.example/scm/~jane.doe/payments:bad.git",
    "https://bitbucket.example/scm/PROJECT/..git",
    "https://bitbucket.example/scm/PROJECT/...git",
    "https://private-user:private-token@bitbucket.example/scm/PROJECT/%private-token.git",
]) {
    test(`reject invalid remote ${url}`, () => {
        assert.throws(
            () => parseBitbucketRemoteUrl(url),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /Unable to recognize the Bitbucket remote URL/);
                assert.doesNotMatch(error.message + error.stack, /private-token|private-user/);
                assert.equal(error.cause, undefined);
                return true;
            },
        );
    });
}
