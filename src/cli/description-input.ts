import { readFileSync } from "node:fs";

export function loadDescriptionInput(
    options: { descriptionFile?: string; template?: string | false },
    configuredTemplate?: string,
): { kind: "literal" | "template"; content: string } | undefined {
    const path =
        options.descriptionFile ??
        (options.template === false ? undefined : (options.template ?? configuredTemplate));
    if (path === undefined) return undefined;
    if (!path.trim()) throw new Error("Description file path cannot be empty.");
    try {
        const content = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
        return { kind: options.descriptionFile === undefined ? "template" : "literal", content };
    } catch {
        throw new Error("Unable to read the Pull Request description file as UTF-8.");
    }
}
