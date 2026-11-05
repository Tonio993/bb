import type {
    BitbucketCommitMessageSuggestion,
    BitbucketPage,
    BitbucketPullRequest,
    BitbucketPullRequestRef,
    BitbucketPullRequestReviewer,
    BitbucketPullRequestTask,
    BitbucketRepository,
    BitbucketUser,
    BitbucketPullRequestDetails,
    BitbucketMergeability,
} from "./bitbucket-types.ts";

function object(value: unknown, description: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Expected ${description} to be a JSON object.`);
    }
    return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Bitbucket did not provide a valid ${field}.`);
    }
    return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`Bitbucket did not provide a valid ${field}.`);
    }
    return value;
}

export function parseMergeability(value: unknown): BitbucketMergeability {
    const result = object(value, "Pull Request mergeability");
    if (typeof result.conflicted !== "boolean" || !Array.isArray(result.vetoes)) {
        throw new Error("Bitbucket did not provide valid mergeability conflicts and vetoes.");
    }
    const outcome =
        result.outcome === undefined ? undefined : text(result.outcome, "merge outcome");
    if (result.canMerge !== undefined && typeof result.canMerge !== "boolean") {
        throw new Error("Bitbucket did not provide a boolean canMerge value.");
    }
    if (result.canMerge === undefined && outcome === undefined) {
        throw new Error("Bitbucket did not provide a mergeability decision.");
    }
    const vetoes = result.vetoes.map((value) => {
        const veto = object(value, "a merge veto");
        return {
            summaryMessage: text(veto.summaryMessage, "merge veto summary"),
            ...(veto.detailedMessage === undefined
                ? {}
                : {
                      detailedMessage:
                          typeof veto.detailedMessage === "string"
                              ? veto.detailedMessage
                              : text(veto.detailedMessage, "merge veto detail"),
                  }),
        };
    });
    return {
        canMerge:
            result.canMerge === undefined
                ? outcome === "CLEAN" && !result.conflicted && vetoes.length === 0
                : result.canMerge,
        conflicted: result.conflicted,
        ...(outcome === undefined ? {} : { outcome }),
        vetoes,
    };
}

export function parseRepository(value: unknown): BitbucketRepository {
    const repository = object(value, "a repository");
    const project = object(repository.project, "a repository project");
    return {
        ...repository,
        name: text(repository.name, "repository name"),
        slug: text(repository.slug, "repository slug"),
        project: { ...project, key: text(project.key, "repository project key") },
    };
}

function parseRef(value: unknown): BitbucketPullRequestRef {
    const ref = object(value, "a Pull Request ref");
    return {
        ...ref,
        id: text(ref.id, "Pull Request branch ref"),
        displayId: text(ref.displayId, "Pull Request branch display ID"),
        ...(ref.latestCommit === undefined
            ? {}
            : { latestCommit: text(ref.latestCommit, "Pull Request branch commit") }),
        repository: parseRepository(ref.repository),
    };
}

function parseReviewer(value: unknown): BitbucketPullRequestReviewer {
    const reviewer = object(value, "a Pull Request reviewer");
    return {
        ...reviewer,
        status: text(reviewer.status, "Pull Request reviewer status"),
        ...(reviewer.user === undefined ? {} : { user: parseUser(reviewer.user) }),
    };
}

function parseUser(value: unknown): BitbucketUser {
    const user = object(value, "a Bitbucket user");
    const parsed: BitbucketUser = {};
    for (const key of ["name", "slug", "displayName"] as const) {
        if (user[key] !== undefined) parsed[key] = text(user[key], "user " + key);
    }
    if (!parsed.name && !parsed.slug)
        throw new Error("Bitbucket did not provide a user login or slug.");
    return parsed;
}

export function parsePullRequest(value: unknown): BitbucketPullRequest {
    const pr = object(value, "a Pull Request");
    if (typeof pr.version !== "number" || !Number.isSafeInteger(pr.version) || pr.version < 0) {
        throw new Error("Unable to determine the Pull Request version.");
    }
    if (!Array.isArray(pr.reviewers)) {
        throw new Error("Bitbucket did not provide the Pull Request reviewers.");
    }
    const links = object(pr.links, "Pull Request links");
    if (!Array.isArray(links.self))
        throw new Error("Expected Pull Request self links to be an array.");
    return {
        ...pr,
        id: integer(pr.id, "Pull Request ID", 1),
        version: pr.version,
        state: text(pr.state, "Pull Request state"),
        reviewers: pr.reviewers.map(parseReviewer),
        ...(pr.title === undefined ? {} : { title: text(pr.title, "Pull Request title") }),
        ...(pr.author === undefined
            ? {}
            : { author: { user: parseUser(object(pr.author, "a Pull Request author").user) } }),
        fromRef: parseRef(pr.fromRef),
        toRef: parseRef(pr.toRef),
        links: {
            ...links,
            self: links.self.map((value) => {
                const link = object(value, "a Pull Request self link");
                return { ...link, href: text(link.href, "Pull Request URL") };
            }),
        },
    };
}

export function parsePullRequestDetails(value: unknown): BitbucketPullRequestDetails {
    const pr = parsePullRequest(value);
    if (!pr.title || !pr.author)
        throw new Error("Bitbucket did not provide the Pull Request title and author.");
    return { ...pr, title: pr.title, author: pr.author };
}

export function parseTask(value: unknown): BitbucketPullRequestTask {
    const task = object(value, "a Pull Request task");
    return {
        ...task,
        id: integer(task.id, "Pull Request task ID", 1),
        version: integer(task.version, "Pull Request task version"),
        state: text(task.state, "Pull Request task state"),
        severity: text(task.severity, "Pull Request task severity"),
        ...(task.text === undefined
            ? {}
            : {
                  text:
                      typeof task.text === "string"
                          ? task.text
                          : text(task.text, "Pull Request task text"),
              }),
    };
}

export function parseCommitMessageSuggestion(value: unknown): BitbucketCommitMessageSuggestion {
    const suggestion = object(value, "a merge commit message suggestion");
    const { title, body } = suggestion;
    if (title !== undefined && typeof title !== "string") {
        throw new Error("Expected merge commit message title to be a string.");
    }
    if (body !== undefined && typeof body !== "string") {
        throw new Error("Expected merge commit message body to be a string.");
    }
    return { title, body };
}

export function parsePage<T>(
    parseItem: (value: unknown) => T,
): (value: unknown) => BitbucketPage<T> {
    return (value) => {
        const page = object(value, "a Bitbucket page");
        if (!Array.isArray(page.values))
            throw new Error("Expected Bitbucket page values to be an array.");
        if (typeof page.isLastPage !== "boolean")
            throw new Error("Expected Bitbucket page isLastPage to be a boolean.");
        if (page.nextPageStart !== undefined && typeof page.nextPageStart !== "number") {
            throw new Error("Expected Bitbucket next page start to be a number.");
        }
        return {
            ...page,
            size: integer(page.size, "Bitbucket page size"),
            limit: integer(page.limit, "Bitbucket page limit", 1),
            start: integer(page.start, "Bitbucket page start"),
            isLastPage: page.isLastPage,
            nextPageStart: page.nextPageStart,
            values: page.values.map(parseItem),
        };
    };
}
