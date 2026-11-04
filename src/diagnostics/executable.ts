import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export function isExecutableAvailable(
    command: string,
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    const candidates = isAbsolute(command)
        ? [command]
        : (environment.PATH ?? "")
              .split(delimiter)
              .filter(Boolean)
              .map((directory) => join(directory.replace(/^"(.*)"$/, "$1"), command));
    return candidates.some((candidate) => {
        try {
            accessSync(candidate, constants.X_OK);
            return statSync(candidate).isFile();
        } catch {
            return false;
        }
    });
}
