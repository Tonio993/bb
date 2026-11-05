import type { DoctorCheck, DoctorStatus } from "../application/doctor/doctor-types.ts";

export function summarizeDoctorChecks(
    checks: readonly DoctorCheck[],
): Record<DoctorStatus, number> {
    const counts: Record<DoctorStatus, number> = { OK: 0, WARN: 0, FAIL: 0, SKIP: 0 };
    for (const check of checks) counts[check.status]++;
    return counts;
}

export function formatDoctorReport(checks: readonly DoctorCheck[]): {
    lines: string[];
    exitCode: 0 | 1;
} {
    const counts = summarizeDoctorChecks(checks);
    const lines = checks.map((check) => {
        return `[${check.status}] ${check.name}: ${check.message}`;
    });
    lines.push(
        `Summary: ${counts.OK} OK, ${counts.WARN} WARN, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP`,
    );
    return { lines, exitCode: counts.FAIL > 0 ? 1 : 0 };
}
