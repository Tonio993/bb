import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDoctorReport } from "../../src/cli/doctor-report.ts";
import type { DoctorCheck } from "../../src/application/doctor/doctor-types.ts";

test("a mixed report preserves check order, counts every status, and fails when any check fails", () => {
    const checks: readonly DoctorCheck[] = Object.freeze([
        { name: "Warning", status: "WARN", message: "Needs setup" },
        { name: "Failure", status: "FAIL", message: "Cannot run" },
        { name: "Skipped", status: "SKIP", message: "Prerequisite failed" },
        { name: "Success", status: "OK", message: "Still checked" },
        { name: "Another failure", status: "FAIL", message: "Cannot run either" },
    ]);
    const report = formatDoctorReport(checks);
    assert.equal(report.exitCode, 1);
    assert.deepEqual(report.lines, [
        "[WARN] Warning: Needs setup",
        "[FAIL] Failure: Cannot run",
        "[SKIP] Skipped: Prerequisite failed",
        "[OK] Success: Still checked",
        "[FAIL] Another failure: Cannot run either",
        "Summary: 1 OK, 1 WARN, 2 FAIL, 1 SKIP",
    ]);
});

test("warnings and skipped checks do not fail the report", () => {
    const report = formatDoctorReport([
        { name: "Configuration", status: "WARN", message: "Missing optional setup" },
        { name: "Token", status: "SKIP", message: "Not requested" },
    ]);
    assert.equal(report.exitCode, 0);
    assert.equal(report.lines.at(-1), "Summary: 0 OK, 1 WARN, 0 FAIL, 1 SKIP");
});
