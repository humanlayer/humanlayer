import { Effect } from 'effect'

export const reportGitCommandError = (
	error: unknown,
	attributes: Readonly<Record<string, string | number | boolean>> = {},
) => Effect.logError('Git command failed', error).pipe(Effect.annotateLogs({ operation: 'git.run', ...attributes }))
