import { generateSessionTitle } from '@humanlayer/ai/generate-session-title'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq, isNull } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { Sentry } from '../instrument'
import logger from '../logger'
import { createRiptideReliableLanguageModel } from './reliable-language-model'

export interface SessionTitleGenerationParams {
	sessionId: string
	organizationId: string
	userId: string
	prompt: string
	ticketId: string | null
	taskName?: string | null
}

const pendingSessionTitleGenerations = new Set<Promise<void>>()

/**
 * Fire-and-forget AI session title generation. Callers invoke this after their
 * transaction commits, without awaiting it; failures are swallowed to Sentry
 * and never affect the calling procedure.
 */
export function runSessionTitleGenerationAsync(
	db: PostgresJsDatabase,
	{ sessionId, organizationId, userId, prompt, ticketId, taskName }: SessionTitleGenerationParams,
) {
	const generation = generateAndPersistSessionTitle(db, {
		sessionId,
		organizationId,
		userId,
		prompt,
		ticketId,
		taskName,
	})
	pendingSessionTitleGenerations.add(generation)
	void generation.finally(() => pendingSessionTitleGenerations.delete(generation))
	return generation
}

export async function waitForPendingSessionTitleGenerations(): Promise<void> {
	await Promise.all(pendingSessionTitleGenerations)
}

async function generateAndPersistSessionTitle(
	db: PostgresJsDatabase,
	{ sessionId, organizationId, userId, prompt, ticketId, taskName }: SessionTitleGenerationParams,
) {
	try {
		const title = await generateSessionTitle(prompt, ticketId, taskName, {
			model: createRiptideReliableLanguageModel('haiku'),
		})
		const [updatedSession] = await db
			.update(sessions)
			.set({ title })
			.where(
				and(
					eq(sessions.id, sessionId),
					eq(sessions.organization_id, organizationId),
					eq(sessions.created_by, userId),
					isNull(sessions.title),
				),
			)
			.returning({ id: sessions.id })
		if (updatedSession) logger.info({ sessionId, title }, 'AI session title generated')
		else logger.debug({ sessionId }, 'AI session title was not applied because the session already has a title')
	} catch (err) {
		logger.error({ err, sessionId }, 'AI session title generation failed')
		Sentry.captureException(err, {
			tags: { error_type: 'ai_title_generation' },
			extra: { sessionId },
		})
	}
}
