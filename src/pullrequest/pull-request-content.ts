import type {
    GitCommit,
} from "../git/git-client.ts";


export type PullRequestContent = {
    title: string;
    description: string;
};


export function buildPullRequestContent(
    commits: readonly Readonly<GitCommit>[],
    sourceBranch: string,
): PullRequestContent {
    if (commits.length === 0) {
        throw new Error(
            "Cannot generate Pull Request content without commits.",
        );
    }

    const title =
        commits.length === 1
            ? commits[0].subject
            : sourceBranch;

    const commitDescriptions =
        commits.map((commit) => {
            const lines = [
                `* ${commit.subject}`,
            ];

            if (commit.body) {
                const bodyLines =
                    commit.body
                        .split(/\r?\n/)
                        .map(
                            (line) =>
                                line.trim(),
                        )
                        .filter(Boolean);

                for (
                    const line
                    of bodyLines
                ) {
                    lines.push(
                        `    * ${line}`,
                    );
                }
            }

            return lines.join("\n");
        });

    return {
        title,
        description:
            commitDescriptions.join(
                "\n\n&nbsp;\n\n",
            ),
    };
}
