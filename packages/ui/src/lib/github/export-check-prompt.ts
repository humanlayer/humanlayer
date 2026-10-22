/**
 * The prompt a "Send to Agent" on a failing check writes: which checks are red on which pull
 * request, and the two gh commands that say why. It carries no log text and no job links —
 * `gh pr checks` already prints them — so the turn is spent reading, not on the prompt.
 * Pure, so the exact grammar is testable.
 */

export interface CheckPromptPullRequest {
  readonly number: number
}

export interface CheckPromptCheck {
  readonly name: string
}

export interface CheckPromptInput {
  readonly pullRequest: CheckPromptPullRequest
  readonly checks: readonly CheckPromptCheck[]
}

export const formatCheckPrompt = ({ pullRequest, checks }: CheckPromptInput): string =>
  [
    `Fix the failing ${checks.length === 1 ? 'check' : 'checks'} on #${pullRequest.number}:`,
    '',
    ...checks.map((check) => `- ${check.name}`),
    '',
    `Logs: \`gh pr checks ${pullRequest.number}\`, then \`gh run view <run-id> --log-failed\`. If gh is missing or signed out, stop and tell me.`,
  ].join('\n')
