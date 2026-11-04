import type { BitbucketApi } from "./bitbucket-client.ts";
import { parsePage } from "./response-parsers.ts";

export async function checkAuthenticatedAccess(client: Pick<BitbucketApi, "get">): Promise<void> {
    // Validate the page envelope without retaining or displaying private Pull Request data.
    await client.get(
        "/rest/api/latest/dashboard/pull-requests?limit=1&start=0",
        parsePage(() => undefined),
    );
}
