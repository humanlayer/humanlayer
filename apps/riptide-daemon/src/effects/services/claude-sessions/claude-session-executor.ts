import * as Sentry from '@sentry/bun'
import { Cause, Effect, Exit } from 'effect'

import type { SessionExecutor } from '@/agents/shared/run-session'
import type { DaemonRuntime } from '@/effects/runtime'
import { setupArtifactPaths } from '@/lib/artifact-paths'

import { captureClaudeTerminalCause } from '../../observability'
import { ClaudeSessions } from './claude-sessions.service'

export function createClaudeSessionExecutor(daemonRuntime: DaemonRuntime): SessionExecutor {
	return async (context, resumeSessionId, forkMeta) => {
		const input = {
			context,
			setupArtifactPaths: (cwd: string, taskId: string, taskSlug: string) =>
				setupArtifactPaths(cwd, taskId, taskSlug, daemonRuntime),
			resumeSessionId,
			forkMeta,
		}
		const program = Effect.gen(function* () {
			const sessions = yield* ClaudeSessions
			yield* sessions.executeClaudeSession(input)
		}).pipe(
			Effect.annotateLogs({ 'claude.executor': 'effect', sessionId: context.session.id }),
			Effect.withSpan('claude.session_execution', {
				attributes: { 'claude.executor': 'effect', session_id: context.session.id },
			}),
		)
		const exit = await Sentry.startNewTrace(() => daemonRuntime.runPromiseExit(program))
		if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return
		captureClaudeTerminalCause(exit.cause, input)
		throw Cause.squash(exit.cause)
	}
}
