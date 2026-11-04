import assert from "node:assert/strict";
import { test } from "node:test";

import { runCli } from "../../../src/cli/cli.ts";
import type { CommandContext } from "../../../src/cli/command-context.ts";
import type { DoctorCheck } from "../../../src/application/doctor/doctor-types.ts";
import type { DoctorOptions } from "../../../src/application/doctor/doctor-types.ts";

for (const checkToken of [false, true]) {
    test(`doctor awaits remote diagnostics and routes options with check-token=${checkToken}`, async (t) => {
        const output = t.mock.method(console, "log", () => {});
        let finished = false;
        const doctor = t.mock.fn(async (options?: DoctorOptions): Promise<DoctorCheck[]> => {
            assert.deepEqual(options, { remote: true, checkToken });
            await Promise.resolve();
            finished = true;
            return [{ name: "Remote authentication", status: "OK", message: "Checked" }];
        });
        const unexpected = (): never => {
            throw new Error("Unexpected application dependency.");
        };
        const context: CommandContext = {
            doctor,
            get configStore(): never {
                return unexpected();
            },
            get config(): never {
                return unexpected();
            },
            get tokenStore(): never {
                return unexpected();
            },
            get gitClient(): never {
                return unexpected();
            },
            get bitbucketClient(): never {
                return unexpected();
            },
        };
        await runCli(["doctor", "--remote", ...(checkToken ? ["--check-token"] : [])], context);
        assert.equal(finished, true);
        assert.equal(doctor.mock.callCount(), 1);
        assert.deepEqual(
            output.mock.calls.map((call) => call.arguments),
            [["[OK] Remote authentication: Checked"], ["Summary: 1 OK, 0 WARN, 0 FAIL, 0 SKIP"]],
        );
    });
}

for (const status of ["OK", "WARN", "FAIL", "SKIP"] as const) {
    test(`doctor prints ${status} results and sets the expected exit code without resolving clients`, async (t) => {
        const originalExitCode = process.exitCode;
        t.after(() => {
            process.exitCode = originalExitCode;
        });
        process.exitCode = undefined;
        const output = t.mock.method(console, "log", () => {});
        const results: DoctorCheck[] = [
            { name: "First", status, message: "Result" },
            { name: "Last", status: "OK", message: "Still checked" },
        ];
        const doctor = t.mock.fn(async (_options?: DoctorOptions) => results);
        const context: CommandContext = {
            doctor,
            get configStore(): never {
                throw new Error("Unexpected configuration access.");
            },
            get config(): never {
                throw new Error("Unexpected required configuration access.");
            },
            get gitClient(): never {
                throw new Error("Unexpected application Git access.");
            },
            get tokenStore(): never {
                throw new Error("Unexpected token access.");
            },
            get bitbucketClient(): never {
                throw new Error("Unexpected REST access.");
            },
        };
        const checkToken = status === "OK";
        await runCli(checkToken ? ["doctor", "--check-token"] : ["doctor"], context);
        assert.deepEqual(doctor.mock.calls[0].arguments, [{ checkToken, remote: false }]);
        assert.deepEqual(
            output.mock.calls.map((call) => call.arguments),
            [
                [`[${status}] First: Result`],
                ["[OK] Last: Still checked"],
                [
                    `Summary: ${status === "OK" ? 2 : 1} OK, ${status === "WARN" ? 1 : 0} WARN, ${status === "FAIL" ? 1 : 0} FAIL, ${status === "SKIP" ? 1 : 0} SKIP`,
                ],
            ],
        );
        assert.equal(process.exitCode, status === "FAIL" ? 1 : 0);
    });
}
