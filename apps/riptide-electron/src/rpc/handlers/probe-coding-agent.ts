import type { ProbeCodingAgentInput } from '@humanlayer/riptide-electron-rpc'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'

import { ClaudeCodeCli } from '../../diagnostics/claude-code-cli.service'

export const probeCodingAgentHandler = Effect.fn('rpc.probe_coding_agent')(function* (input: ProbeCodingAgentInput) {
	const codingAgentCli = yield* ClaudeCodeCli
	const probe = codingAgentCli.probeAgent
	if (probe === undefined) {
		return {
			status: 'failed' as const,
			agent: input.agent,
			path: input.preferredPath,
			version: null,
			installationSource: null,
			failure: { reason: 'smoke_test_failed' as const, details: 'Coding-agent probes are unavailable' },
			checkedAt: yield* Clock.currentTimeMillis,
		}
	}
	return yield* probe(input).pipe(
		Effect.annotateSpans({ rpc_operation: 'ProbeCodingAgent', coding_agent: input.agent }),
		Effect.annotateLogs({ rpc_operation: 'ProbeCodingAgent', coding_agent: input.agent }),
	)
})
