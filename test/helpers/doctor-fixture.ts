import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

export function createDoctorCliFixture(t: TestContext, content?: string) {
    const directory = mkdtempSync(join(tmpdir(), "bb-doctor-cli-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const configPath =
        process.platform === "darwin"
            ? join(directory, "Library", "Application Support", "bb", "config.json")
            : join(directory, "bb", "config.json");
    if (content !== undefined) {
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, content);
    }
    const environment = {
        ...process.env,
        HOME: directory,
        USERPROFILE: directory,
        APPDATA: directory,
        XDG_CONFIG_HOME: directory,
        BB_TOKEN: "doctor-test-token",
    };
    return { directory, configPath, environment };
}
