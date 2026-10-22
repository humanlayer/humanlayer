import * as Effect from 'effect/Effect'

import { ClaudeCodeCli } from '../../diagnostics/claude-code-cli.service'

export const checkClaudeInstalledHandler = Effect.fn('rpc.check_claude_installed')(function* () {
	const claudeCodeCli = yield* ClaudeCodeCli
	return yield* claudeCodeCli.checkInstallation.pipe(
		Effect.annotateSpans({ rpc_operation: 'CheckClaudeInstalled' }),
		Effect.annotateLogs({ rpc_operation: 'CheckClaudeInstalled' }),
	)
})
