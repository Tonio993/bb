import type { PullRequestChecks } from "../application/pull-request-check-types.ts";
import type { PullRequestChecksOutput } from "./json-output-types.ts";
import { formatPullRequestView, toPullRequestViewOutput } from "./pull-request-view-output.ts";

export function toPullRequestChecksOutput(result: PullRequestChecks): PullRequestChecksOutput {
    return {
        pullRequest: toPullRequestViewOutput(result.view),
        readyForMerge: result.readyForMerge,
        checks: result.checks.map(({ code, status, message }) => ({ code, status, message })),
        server:
            result.server === null
                ? null
                : {
                      canMerge: result.server.canMerge,
                      conflicted: result.server.conflicted,
                      outcome: result.server.outcome ?? null,
                      vetoes: result.server.vetoes.map(({ summaryMessage, detailedMessage }) => ({
                          summaryMessage,
                          detailedMessage: detailedMessage ?? null,
                      })),
                  },
    };
}

export function formatPullRequestChecks(result: PullRequestChecks): string {
    const clean = (value: string) =>
        value
            .replace(/[\p{Cc}\p{Cf}]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    return [
        formatPullRequestView(result.view),
        "",
        ...result.checks.map(
            (check) => "[" + check.status + "] " + check.code + ": " + clean(check.message),
        ),
        ...(result.server
            ? [
                  "Server outcome: " + clean(result.server.outcome ?? "(not provided)"),
                  "Server can merge: " + result.server.canMerge,
                  "Conflicted: " + result.server.conflicted,
                  ...result.server.vetoes.map(
                      (veto) =>
                          "Veto: " +
                          clean(veto.summaryMessage) +
                          (veto.detailedMessage ? " - " + clean(veto.detailedMessage) : ""),
                  ),
              ]
            : []),
        result.readyForMerge
            ? "Ready for merge at the time of this check."
            : "Not ready for merge.",
        "This read-only snapshot does not guarantee a later merge; Bitbucket checks still apply.",
    ].join("\n");
}
