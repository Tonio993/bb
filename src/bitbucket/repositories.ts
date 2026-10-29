import {
    BitbucketClient,
} from "./bitbucket-client.ts";

import type {
    BitbucketPage,
    BitbucketRepository,
} from "./bitbucket-types.ts";


export async function getProjectRepositories(
    client: BitbucketClient,
    projectKey: string,
): Promise<BitbucketRepository[]> {
    const repositories: BitbucketRepository[] = [];

    const encodedProjectKey =
        encodeURIComponent(projectKey);

    let start = 0;
    const limit = 100;

    while (true) {
        const path =
            `rest/api/latest/projects/${encodedProjectKey}` +
            `/repos` +
            `?start=${start}&limit=${limit}`;

        const response =
            await client.get<
                BitbucketPage<BitbucketRepository>
            >(path);

        repositories.push(
            ...response.values,
        );

        if (response.isLastPage) {
            return repositories;
        }

        if (response.nextPageStart === undefined) {
            throw new Error(
                "Bitbucket did not provide the next repository page.",
            );
        }

        start = response.nextPageStart;
    }
}
