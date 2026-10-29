import type {
    BitbucketCommitMessageSuggestion,
} from "../bitbucket/bitbucket-types.ts";

export function buildMergeCommitMessage(
    suggestion: BitbucketCommitMessageSuggestion,
    prefix: string,
): string {
    const message = [suggestion.title, suggestion.body]
        .filter((part): part is string =>
            typeof part === "string" && Boolean(part.trim()),
        )
        .join("\n\n");

    if (!message) {
        throw new Error(
            "Bitbucket did not provide a merge commit message.",
        );
    }

    return `${prefix}${message}`;
}
