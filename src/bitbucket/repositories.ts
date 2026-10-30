import {
    BitbucketClient,
} from "./bitbucket-client.ts";

import type {
    BitbucketRepository,
} from "./bitbucket-types.ts";
import { parseRepository } from "./response-parsers.ts";
import { iterateBitbucketPages } from "./pagination.ts";


export async function getProjectRepositories(
    client: BitbucketClient,
    projectKey: string,
): Promise<BitbucketRepository[]> {
    const repositories: BitbucketRepository[] = [];

    const encodedProjectKey =
        encodeURIComponent(projectKey);

    const path = `rest/api/latest/projects/${encodedProjectKey}/repos`;
    for await (const page of iterateBitbucketPages(client, path, parseRepository, "repository")) {
        repositories.push(...page.values);
    }
    return repositories;
}
