import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { BitbucketApiError } from "../src/bitbucket/bitbucket-api-error.ts";
import { BitbucketClient, type FetchImplementation } from "../src/bitbucket/bitbucket-client.ts";
import { iterateBitbucketPages } from "../src/bitbucket/pagination.ts";

function page(values: unknown[], start = 0, nextPageStart?: number) {
    return { values, size: values.length, limit: 100, start, isLastPage: nextPageStart === undefined, nextPageStart };
}

function api(t: TestContext, responses: { body: unknown; status?: number }[]) {
    const paths: string[] = [];
    const request = t.mock.fn<FetchImplementation>(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        paths.push(`${url.pathname}${url.search}`);
        const response = responses.shift();
        assert.ok(response, "Unexpected page request.");
        return Response.json(response.body, { status: response.status ?? 200 });
    });
    const client = new BitbucketClient({ url: "https://bitbucket.example/bitbucket", projectKey: "PROJECT", defaultReviewers: [] }, () => "test-token", { fetch: request });
    const parseNumber = (value: unknown): number => {
        if (typeof value !== "number") throw new Error("Expected a number.");
        return value;
    };
    return {
        paths,
        pages: (path = "rest/api/latest/items") => iterateBitbucketPages(client, path, parseNumber, "item"),
    };
}

test("pages are lazy and closing the iterator neither validates the next cursor nor requests another page", async (t) => {
    const fixture = api(t, [{ body: { ...page([1]), isLastPage: false } }]);
    const pages = fixture.pages();
    assert.equal(fixture.paths.length, 0);
    for await (const result of pages) {
        assert.deepEqual(result.values, [1]);
        break;
    }
    assert.equal(fixture.paths.length, 1);
    assert.equal((await pages.next()).done, true);
});

test("empty intermediate pages follow server cursors and preserve existing query parameters and item order", async (t) => {
    const fixture = api(t, [
        { body: page([], 0, 37) },
        { body: page([2, 1], 37, 81) },
        { body: page([], 81, 90) },
        { body: page([1], 90) },
    ]);
    const values: number[] = [];
    for await (const result of fixture.pages("rest/api/latest/items?state=OPEN&filter=a%26b")) values.push(...result.values);
    assert.deepEqual(values, [2, 1, 1]);
    assert.deepEqual(fixture.paths, [0, 37, 81, 90].map(
        (start) => `/bitbucket/rest/api/latest/items?state=OPEN&filter=a%26b&start=${start}&limit=100`,
    ));
});

test("an empty final page ends iteration without requesting another page", async (t) => {
    const fixture = api(t, [{ body: page([]) }]);
    for await (const result of fixture.pages()) assert.deepEqual(result.values, []);
    assert.deepEqual(fixture.paths, ["/bitbucket/rest/api/latest/items?start=0&limit=100"]);
});

for (const next of [undefined, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    test(`a non-final page with cursor ${next} cannot trigger an invalid next request`, async (t) => {
        const fixture = api(t, [{ body: { ...page([]), isLastPage: false, nextPageStart: next } }]);
        await assert.rejects(async () => {
            for await (const _page of fixture.pages()) { /* Consume all pages. */ }
        }, /next item page/);
        assert.equal(fixture.paths.length, 1);
    });
}

for (const next of [0, 37]) {
    test(`a later cursor moving from 37 to ${next} stops iteration`, async (t) => {
        const fixture = api(t, [{ body: page([], 0, 37) }, { body: page([], 37, next) }]);
        await assert.rejects(async () => {
            for await (const _page of fixture.pages()) { /* Consume all pages. */ }
        }, /next item page/);
        assert.equal(fixture.paths.length, 2);
    });
}

test("HTTP failures on later pages retain their context and stop further requests", async (t) => {
    const fixture = api(t, [
        { body: page([1], 0, 37) },
        { body: { errors: [{ message: "Unavailable." }] }, status: 503 },
    ]);
    await assert.rejects(async () => {
        for await (const _page of fixture.pages()) { /* Consume all pages. */ }
    }, (error: unknown) => {
        assert.ok(error instanceof BitbucketApiError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.method, "GET");
        assert.equal(error.path, "rest/api/latest/items?start=37&limit=100");
        return true;
    });
    assert.equal(fixture.paths.length, 2);
});

test("invalid items are rejected before yielding a partial page", async (t) => {
    const fixture = api(t, [{ body: page([1, "invalid"]) }]);
    let yielded = false;
    await assert.rejects(async () => {
        for await (const _page of fixture.pages()) yielded = true;
    }, /Expected a number/);
    assert.equal(yielded, false);
    assert.equal(fixture.paths.length, 1);
});
