import type { BitbucketClient, ResponseParser } from "./bitbucket-client.ts";
import type { BitbucketPage } from "./bitbucket-types.ts";
import { parsePage } from "./response-parsers.ts";

export async function* iterateBitbucketPages<T>(
    client: BitbucketClient,
    path: string,
    parseItem: ResponseParser<T>,
    pageDescription: string,
): AsyncGenerator<BitbucketPage<T>> {
    const parse = parsePage(parseItem);
    const separator = path.includes("?") ? "&" : "?";
    let start = 0;

    while (true) {
        const page = await client.get(`${path}${separator}start=${start}&limit=100`, parse);
        yield page;

        // Consumers may stop after a match without needing another page.
        if (page.isLastPage) return;
        const next = page.nextPageStart;
        if (next === undefined || !Number.isSafeInteger(next) || next <= start) {
            throw new Error(`Bitbucket did not provide the next ${pageDescription} page.`);
        }
        start = next;
    }
}
