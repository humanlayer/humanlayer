import { Effect } from 'effect'

import { GitCommandRunner } from './services/task-diff/git-command-runner.service'

const ARTIFACTS_GIT_PATH = '.humanlayer/tasks'

export type ArtifactIgnoreStatus = 'ignored' | 'not-ignored'

export const checkArtifactsGitignored = Effect.fn('artifacts.check_git_ignore_status')(function* (input: {
	readonly cwd: string
}) {
	const gitCommandRunner = yield* GitCommandRunner
	const result = yield* gitCommandRunner.run(['check-ignore', '--quiet', '--no-index', '--', ARTIFACTS_GIT_PATH], {
		cwd: input.cwd,
		okExitCodes: [0, 1],
	})
	const status: ArtifactIgnoreStatus = result.exitCode === 0 ? 'ignored' : 'not-ignored'

	yield* Effect.logDebug('Checked artifact Git ignore status').pipe(
		Effect.annotateLogs({ cwd: input.cwd, artifactPath: ARTIFACTS_GIT_PATH, status }),
	)

	return status
})
