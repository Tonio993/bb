import type { Command } from "commander";
import type { JsonError, JsonResult } from "./json-output-types.ts";

export function usesJsonOutput(command: Command): boolean {
    return command.optsWithGlobals().json === true;
}

export function commandName(command: Command): string | null {
    const names: string[] = [];
    for (let current = command; current.parent; current = current.parent)
        names.unshift(current.name());
    return names.length ? names.join(" ") : null;
}

export function writeJsonResult<T>(
    command: string | null,
    data: T | null,
    error: JsonError | null = null,
): void {
    const result: JsonResult<T> = {
        schemaVersion: 1,
        command,
        ok: error === null,
        exitCode: error === null ? 0 : 1,
        data,
        error,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
}
