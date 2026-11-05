import type { Command } from "commander";
import type { CommandContext } from "../command-context.ts";
import type { DoctorOptions } from "../../application/doctor/doctor-types.ts";
import { formatDoctorReport, summarizeDoctorChecks } from "../doctor-report.ts";
import { usesJsonOutput, writeJsonResult } from "../json-output.ts";

export function registerDoctorCommand(program: Command, context: CommandContext): void {
    program
        .command("doctor")
        .description(
            "Check local tools, configuration, and credentials; remote checks are optional.",
        )
        .option("--json", "Output a versioned JSON result for scripts and CI")
        .option(
            "--check-token",
            "Read and validate the token; the operating system may prompt for storage access",
        )
        .option(
            "--remote",
            "Check authenticated Bitbucket access using a read-only request; implies token reading",
        )
        .addHelpText(
            "after",
            "\nResults: OK, WARN, FAIL, SKIP. Exit code: 1 if any check fails, otherwise 0.\nToken values are never displayed. Remote checks do not verify repository permissions.",
        )
        .action(async (options: DoctorOptions, command: Command) => {
            const results = await context.doctor({
                checkToken: options.checkToken === true,
                remote: options.remote === true,
            });
            const report = formatDoctorReport(results);
            if (usesJsonOutput(command)) {
                writeJsonResult(
                    "doctor",
                    {
                        checks: results.map(({ name, status, message }) => ({
                            name,
                            status,
                            message,
                        })),
                        summary: summarizeDoctorChecks(results),
                    },
                    report.exitCode
                        ? {
                              code: "DIAGNOSTIC_FAILED",
                              message: "One or more diagnostic checks failed.",
                          }
                        : null,
                );
                return;
            }
            for (const line of report.lines) {
                console.log(line);
            }
            process.exitCode = report.exitCode;
        });
}
