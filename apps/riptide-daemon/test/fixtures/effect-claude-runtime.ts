import type { Session } from '@humanlayer/db/tables/sessions'
import { Effect } from 'effect'

import type { SessionContext } from '@/agents/shared/run-session'

import { createTestSession } from '../helpers/session-fixtures'

export function makeBasicEffectSession(overrides: Partial<Session> = {}): Session {
	return createTestSession({
		id: 'effect-session-1',
		working_directory: '/tmp',
		prompt: 'Reply with EFFECT_RUNTIME_SMOKE_TEST only.',
		permissions_mode: 'bypass',
		...overrides,
	})
}

export function makeSessionContext(session: Session): SessionContext {
	return {
		session,
		services: {} as SessionContext['services'],
		interruptState: {
			get: Effect.succeed({ wasInterrupted: false, resumeWithPrompt: null }),
			wasInterrupted: Effect.succeed(false),
			resumeWithPrompt: Effect.succeed(null),
			markInterrupted: () => Effect.void,
		},
		continuationKind: 'ordinary',
	}
}
