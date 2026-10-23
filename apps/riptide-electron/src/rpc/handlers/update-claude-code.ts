import * as Effect from 'effect/Effect'

import { ClaudeCodeCli } from '../../diagnostics/claude-code-cli.service'

export const updateClaudeCodeHandler = Effect.fn('rpc.update_claude_code')(function* () {
	const claudeCodeCli = yield* ClaudeCodeCli
	return yield* claudeCodeCli.updateToLatest.pipe(
		Effect.annotateSpans({ rpc_operation: 'UpdateClaudeCode' }),
		Effect.annotateLogs({ rpc_operation: 'UpdateClaudeCode' }),
	)
})
