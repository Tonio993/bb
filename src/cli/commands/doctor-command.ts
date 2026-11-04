import type { Command } from "commander";
import type { CommandContext } from "../command-context.ts";
import type { DoctorOptions } from "../../application/doctor/doctor-types.ts";
import { formatDoctorReport } from "../doctor-report.ts";

export function registerDoctorCommand(program: Command, context: CommandContext): void {
    program
        .command("doctor")
        .description(
            "Check local tools, configuration, and credentials; remote checks are optional.",
        )
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
        .action(async (options: DoctorOptions) => {
            const results = await context.doctor({
                checkToken: options.checkToken === true,
                remote: options.remote === true,
            });
            const report = formatDoctorReport(results);
            for (const line of report.lines) {
                console.log(line);
            }
            process.exitCode = report.exitCode;
        });
}
