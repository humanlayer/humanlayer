import type { conversationEventSelectSchema } from '@humanlayer/db/tables/conversation-events'
import type { QueuedMessage } from '@humanlayer/db/tables/queued-messages'
import type { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { isDefinedError, ORPCError } from '@orpc/client'
import { createCollection } from '@tanstack/db'
import { uuidv7 } from 'uuidv7'
import { describe, expect, test, vi } from 'vitest'
import type z from 'zod/v4'

import { buildOptimisticSessionRow, createSessionActions, createSessionV2Actions } from '@/actions/sessions'

type SyncWrite<T> = { type: 'insert' | 'update' | 'delete'; value: T }

/**
 * A collection backed by a manual sync loop. The seeded rows are *synced*
 * state (what Electric last delivered), so the collection models a client
 * whose view may be stale relative to the server. `deliverSyncedChange` plays
 * the role of Electric delivering a later change.
 */
function createTestCollection<T extends { id: string }>(name: string, rows: T[]) {
	let controls: { begin: () => void; write: (msg: SyncWrite<T>) => void; commit: () => void } | undefined

	const collection = createCollection<T>({
		id: `test-${name}-${uuidv7()}`,
		getKey: (row) => row.id,
		startSync: true,
		sync: {
			sync: ({ begin, write, commit, markReady }) => {
				controls = { begin, write, commit }
				begin()
				for (const row of rows) write({ type: 'insert', value: row })
				commit()
				markReady()
			},
		},
	})

	const deliverSyncedChange = (change: SyncWrite<T>) => {
		if (!controls) throw new Error('sync not started')
		controls.begin()
		controls.write(change)
		controls.commit()
	}

	return { collection, deliverSyncedChange }
}

function createTestQueuedMessagesCollection(rows: QueuedMessage[]) {
	return createTestCollection('queued-messages', rows)
}

function makePendingMessage(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
	return {
		id: uuidv7(),
		session_id: uuidv7(),
		task_id: null,
		organization_id: uuidv7(),
		resource_owner_user_id: 'user-1',
		user_id: 'user-1',
		content: 'original content',
		status: 'pending',
		created_at: BigInt(Date.now()),
		updated_at: BigInt(Date.now()),
		...overrides,
	}
}

const unusedApi = () => {
	throw new Error('not expected to be called in this test')
}

function makeActions({
	queuedMessagesCollection,
	updateQueuedMessage,
	queuedMessagesConfirmTx,
}: {
	queuedMessagesCollection: ReturnType<typeof createTestQueuedMessagesCollection>['collection']
	updateQueuedMessage: (input: {
		sessionId: string
		queuedMessageId: string
		text: string
	}) => Promise<{ transactionId: string; success: boolean }>
	queuedMessagesConfirmTx: (txid: string) => Promise<void>
}) {
	const stubCollection = { state: new Map() }
	return createSessionV2Actions(
		stubCollection as any,
		stubCollection as any,
		queuedMessagesCollection as any,
		{
			continue: unusedApi as any,
			updateQueuedMessage: updateQueuedMessage as any,
			deleteQueuedMessage: unusedApi as any,
			requestSendQueuedMessageNow: unusedApi as any,
		},
		'user-1',
		'org-1',
		async () => {},
		queuedMessagesConfirmTx,
	)
}

describe('continueV2 optimistic queue attribution', () => {
	test('stamps the current actor on an optimistic queued row', async () => {
		const sessionId = uuidv7()
		const messageId = uuidv7()
		const eventsCollection = { state: new Map() }
		const sessionsCollection = {
			state: new Map([[sessionId, { id: sessionId, task_id: null, resource_owner_user_id: 'owner-user' }]]),
		}
		const { collection, deliverSyncedChange } = createTestQueuedMessagesCollection([])
		const api = vi.fn(async () => {
			deliverSyncedChange({
				type: 'insert',
				value: makePendingMessage({
					id: messageId,
					session_id: sessionId,
					organization_id: 'org-1',
					resource_owner_user_id: 'owner-user',
					user_id: 'actor-user',
				}),
			})
			return { kind: 'queued' as const, transactionId: '456' }
		})
		const actions = createSessionV2Actions(
			sessionsCollection as any,
			eventsCollection as any,
			collection as any,
			{
				continue: api as any,
				updateQueuedMessage: unusedApi as any,
				deleteQueuedMessage: unusedApi as any,
				requestSendQueuedMessageNow: unusedApi as any,
			},
			'actor-user',
			'org-1',
			async () => {},
			async () => {},
		)

		const tx = actions.continueV2({
			sessionId,
			messageId,
			eventId: uuidv7(),
			text: 'queued by actor',
			intent: 'queue',
		})

		expect(collection.get(messageId)?.user_id).toBe('actor-user')
		await tx.isPersisted.promise
		expect(collection.get(messageId)?.user_id).toBe('actor-user')
	})
})

describe('optimistic session context limits', () => {
	test('uses the verified 500k context window for a Fold Grok session', () => {
		const row = buildOptimisticSessionRow(
			{
				id: 'session-grok',
				workingDirectory: '/repo',
				hostId: 'host-1',
				codingAgent: 'fold',
				provider: 'xai',
				model: 'grok-4.6',
				status: 'pending',
				numEvents: 0,
			},
			{ userId: 'user-1', organizationId: 'org-1', resourceOwnerUserId: 'user-1' },
		)

		expect(row.context_window_limit).toBe(500_000)
	})
})

describe('updateQueuedMessage optimistic action', () => {
	test('applies the edit optimistically and keeps it once the server confirms and sync delivers', async () => {
		const row = makePendingMessage()
		const { collection, deliverSyncedChange } = createTestQueuedMessagesCollection([row])

		const api = vi.fn(async () => ({ transactionId: '123', success: true }))
		// confirmTx resolving models awaitTxId: Electric has delivered the server's row
		const confirmTx = vi.fn(async (_txid: string) => {
			deliverSyncedChange({ type: 'update', value: { ...row, content: 'edited content' } })
		})
		const actions = makeActions({
			queuedMessagesCollection: collection,
			updateQueuedMessage: api,
			queuedMessagesConfirmTx: confirmTx,
		})

		const tx = actions.updateQueuedMessage({
			sessionId: row.session_id,
			queuedMessageId: row.id,
			text: 'edited content',
		})

		// optimistic layer applied synchronously, before any server round-trip
		expect(collection.get(row.id)?.content).toBe('edited content')

		await tx.isPersisted.promise

		expect(api).toHaveBeenCalledTimes(1)
		expect(confirmTx).toHaveBeenCalledWith('123')
		expect(collection.get(row.id)?.content).toBe('edited content')
	})

	test('rolls back the edit when the message was already sent on the server but the client has not synced yet', async () => {
		// Client state is stale: the row is still pending here, but the server
		// has already delivered it. The save races against that delivery and loses.
		const row = makePendingMessage()
		const { collection, deliverSyncedChange } = createTestQueuedMessagesCollection([row])

		const api = vi.fn(async () => {
			throw new ORPCError('QUEUED_MESSAGE_UPDATE_FAILED', {
				status: 400,
				defined: true,
				data: { reason: 'already_delivered' },
			})
		})
		const confirmTx = vi.fn(async (_txid: string) => {})
		const actions = makeActions({
			queuedMessagesCollection: collection,
			updateQueuedMessage: api,
			queuedMessagesConfirmTx: confirmTx,
		})

		const tx = actions.updateQueuedMessage({
			sessionId: row.session_id,
			queuedMessageId: row.id,
			text: 'edited too late',
		})

		// the edit shows instantly while the request is in flight
		expect(collection.get(row.id)?.content).toBe('edited too late')

		const error = await tx.isPersisted.promise.then(
			() => null,
			(err) => err,
		)

		// the defined error surfaces as-is so the UI layer can match on its code
		expect(error).not.toBeNull()
		expect(isDefinedError(error)).toBe(true)
		expect((error as { code?: string }).code).toBe('QUEUED_MESSAGE_UPDATE_FAILED')
		expect(confirmTx).not.toHaveBeenCalled()

		// rollback restores the stale synced row — original content, still pending
		expect(collection.get(row.id)?.content).toBe('original content')
		expect(collection.get(row.id)?.status).toBe('pending')

		// when Electric finally delivers the delivery, the client converges and a
		// pending-filtered view (useSessionQueuedMessages) would drop the bubble
		deliverSyncedChange({ type: 'update', value: { ...row, status: 'delivered' } })
		expect(collection.get(row.id)?.status).toBe('delivered')
	})
})

describe('launchSession routing', () => {
	type SessionRow = z.infer<typeof sessionSelectSchema>
	type EventRow = z.infer<typeof conversationEventSelectSchema>

	function makeDraftRow(overrides: Partial<SessionRow>): SessionRow {
		return {
			...buildOptimisticSessionRow(
				{
					id: uuidv7(),
					workingDirectory: '/draft',
					hostId: 'host-1',
					codingAgent: 'claude',
					status: 'draft',
					numEvents: 0,
				},
				{ userId: 'user-1', organizationId: 'org-1', resourceOwnerUserId: 'user-1' },
			),
			...overrides,
		}
	}

	function makeLaunchActions({
		tasks,
		sessions = [],
	}: {
		tasks: Array<{ id: string; workspace_id: string | null; resource_owner_user_id: string }>
		sessions?: SessionRow[]
	}) {
		const { collection: sessionsCollection } = createTestCollection<SessionRow>('sessions', sessions)
		const { collection: eventsCollection } = createTestCollection<EventRow>('events', [])
		const tasksCollection = { state: new Map(tasks.map((task) => [task.id, task])) }
		const launch = vi.fn(async () => ({ transactionId: 'legacy-tx', session: {} }))
		const createV2 = vi.fn(async (input: { sessionId?: string }) => ({
			result: 'created' as const,
			transactionId: 'v2-tx',
			sessionId: input.sessionId ?? uuidv7(),
		}))
		const confirmTx = vi.fn(async (_txid: string) => {})
		const actions = createSessionActions(
			sessionsCollection as any,
			{ sessions: { update: unusedApi as any, continue: unusedApi as any, interrupt: unusedApi as any } },
			'user-1',
			'org-1',
			eventsCollection as any,
			tasksCollection as any,
			{ launch: launch as any, create: unusedApi as any, fork: unusedApi as any, createV2: createV2 as any },
			confirmTx,
		)
		return { actions, sessionsCollection, eventsCollection, launch, createV2, confirmTx }
	}

	const baseLaunch = {
		text: 'hello',
		title: 'Session',
		workingDirectory: '/ignored/for/v2',
		hostId: 'host-1',
		codingAgent: 'claude' as const,
		provider: 'anthropic',
		model: 'opus',
		effort: 'high',
		fastMode: false,
		permissionsMode: 'accept_edits' as const,
	}

	test('routes a project-backed task to sessions.v2.create and never calls the legacy launch', async () => {
		const taskId = uuidv7()
		const workspaceId = uuidv7()
		const sessionId = uuidv7()
		const eventId = uuidv7()
		const { actions, sessionsCollection, eventsCollection, launch, createV2, confirmTx } = makeLaunchActions({
			tasks: [{ id: taskId, workspace_id: workspaceId, resource_owner_user_id: 'owner-user' }],
		})

		const tx = actions.launchSession({ ...baseLaunch, id: sessionId, eventId, taskId, workspaceId })

		// optimistic session and first message are visible before the server answers
		expect(sessionsCollection.get(sessionId)?.status).toBe('ready_for_launch')
		expect(sessionsCollection.get(sessionId)?.resource_owner_user_id).toBe('owner-user')
		expect(eventsCollection.get(eventId)?.content).toBe('hello')

		await tx.isPersisted.promise

		expect(launch).not.toHaveBeenCalled()
		expect(createV2).toHaveBeenCalledTimes(1)
		expect(createV2).toHaveBeenCalledWith({
			sessionId,
			eventId,
			taskId,
			workspaceId,
			title: 'Session',
			text: 'hello',
			hostId: 'host-1',
			codingAgent: 'claude',
			provider: 'anthropic',
			model: 'opus',
			effort: 'high',
			fastMode: false,
			permissionsMode: 'accept_edits',
		})
		expect(confirmTx).toHaveBeenCalledWith('v2-tx')
	})

	test('derives the project-backed route from the task row when the caller omits workspaceId', async () => {
		const taskId = uuidv7()
		const workspaceId = uuidv7()
		const { actions, launch, createV2 } = makeLaunchActions({
			tasks: [{ id: taskId, workspace_id: workspaceId, resource_owner_user_id: 'user-1' }],
		})

		await actions.launchSession({ ...baseLaunch, id: uuidv7(), eventId: uuidv7(), taskId }).isPersisted.promise

		expect(launch).not.toHaveBeenCalled()
		expect(createV2).toHaveBeenCalledWith(expect.objectContaining({ taskId, workspaceId }))
	})

	test('keeps the legacy launch for a directory-backed task', async () => {
		const taskId = uuidv7()
		const sessionId = uuidv7()
		const { actions, launch, createV2, confirmTx } = makeLaunchActions({
			tasks: [{ id: taskId, workspace_id: null, resource_owner_user_id: 'user-1' }],
		})

		await actions.launchSession({ ...baseLaunch, id: sessionId, eventId: uuidv7(), taskId, workspaceId: null })
			.isPersisted.promise

		expect(createV2).not.toHaveBeenCalled()
		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({ id: sessionId, taskId, workingDirectory: '/ignored/for/v2' }),
		)
		expect(confirmTx).toHaveBeenCalledWith('legacy-tx')
	})

	test('keeps the legacy launch for a session without a task', async () => {
		const { actions, launch, createV2 } = makeLaunchActions({ tasks: [] })

		await actions.launchSession({ ...baseLaunch, id: uuidv7(), eventId: uuidv7() }).isPersisted.promise

		expect(createV2).not.toHaveBeenCalled()
		expect(launch).toHaveBeenCalledTimes(1)
	})

	test('promotes a draft into a project-backed task without falling back to legacy', async () => {
		const taskId = uuidv7()
		const workspaceId = uuidv7()
		const draft = makeDraftRow({ task_id: taskId })
		const { actions, sessionsCollection, launch, createV2, confirmTx } = makeLaunchActions({
			tasks: [{ id: taskId, workspace_id: workspaceId, resource_owner_user_id: 'user-1' }],
			sessions: [draft],
		})

		const tx = actions.launchSession({
			...baseLaunch,
			id: draft.id,
			draftId: draft.id,
			eventId: uuidv7(),
			taskId,
			workspaceId,
		})
		expect(sessionsCollection.get(draft.id)?.status).toBe('ready_for_launch')

		await tx.isPersisted.promise
		expect(launch).not.toHaveBeenCalled()
		expect(createV2).toHaveBeenCalledWith(
			expect.objectContaining({
				draftId: draft.id,
				sessionId: draft.id,
				taskId,
				workspaceId,
			}),
		)
		expect(confirmTx).toHaveBeenCalledWith('v2-tx')
	})
})
