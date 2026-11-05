import type { BitbucketApi } from "./bitbucket-client.ts";
import type { DeleteBranchOptions } from "./branch-types.ts";

export async function deleteBranch(
    client: Pick<BitbucketApi, "delete">,
    options: DeleteBranchOptions,
): Promise<void> {
    if (!options.projectKey?.trim() || !options.repository?.trim()) {
        throw new Error("The source repository project and slug are required for branch deletion.");
    }
    if (!options.name?.startsWith("refs/heads/") || options.name === "refs/heads/") {
        throw new Error("A full source branch ref is required for branch deletion.");
    }
    if (!options.endPoint?.trim()) {
        throw new Error("The expected source commit is required for branch deletion.");
    }
    const path =
        `rest/branch-utils/latest/projects/${encodeURIComponent(options.projectKey)}` +
        `/repos/${encodeURIComponent(options.repository)}/branches`;
    await client.delete(
        path,
        {
            name: options.name,
            endPoint: options.endPoint,
            dryRun: false,
        },
        (value) => {
            if (value !== undefined) {
                throw new Error("Expected an empty response confirming source branch deletion.");
            }
        },
    );
}
