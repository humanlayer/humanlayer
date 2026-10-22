/** The prompt the "Open a draft PR" control writes as an ordinary turn to the agent. */
export const OPEN_PULL_REQUEST_PROMPT =
  'use the /rpi:describe-pr skill - use the --draft flag to gh pr create'

export const formatOpenPullRequestPrompt = (instructions?: string | null): string => {
  const extra = instructions?.trim()
  return extra ? `${OPEN_PULL_REQUEST_PROMPT}\n\n${extra}` : OPEN_PULL_REQUEST_PROMPT
}
