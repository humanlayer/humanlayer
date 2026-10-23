import { it } from '@effect/vitest'
import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { Effect, Layer, Stream } from 'effect'
import { describe, expect, vi } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import { ClaudeSdkError } from '@/effects/services/claude-sessions/sdk/claude-sdk-error'
import type { ClaudeSdkSession } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.service'
import { requestToolApproval } from '@/effects/services/claude-sessions/workflows/approvals'
import { observeLiveSessionControls } from '@/effects/services/claude-sessions/workflows/live-controls'
import { DaemonCollectionsLive } from '@/effects/services/daemon-collections/daemon-collections.layer'
import {
	DaemonCollections,
	type DaemonCollectionsService,
} from '@/effects/services/daemon-collections/daemon-collections.service'

import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'

const approvalId = 'approval-effect-1'
const baseApproval = {
	id: approvalId,
	session_id: 'session-1',
	organization_id: 'org-1',
	user_id: 'user-1',
	host_id: 'host-1',
	resource_owner_user_id: 'user-1',
	task_id: null,
	tool_use_id: 'tool-use-1',
	status: 'approved',
	comment: null,
	applied_suggestions: null,
}
const appliedSuggestions: PermissionUpdate[] = [
	{
		type: 'addRules',
		rules: [{ toolName: 'Bash', ruleContent: 'git push *' }],
		behavior: 'allow',
		destination: 'localSettings',
	},
]

function makeCollection(initial: unknown[] = [], changes: unknown[] = []) {
	const state = new Map<string, unknown>()
	for (const value of initial as Array<{ id: string }>) state.set(value.id, value)
	const unsubscribe = vi.fn()
	const subscribeChanges = vi.fn((callback: (batch: unknown[]) => void) => {
		if (changes.length > 0) queueMicrotask(() => callback(changes))
		return { unsubscribe }
	})
	return { state, toArray: initial, subscribeChanges, unsubscribe }
}

function makeCollections(approvals = makeCollection(), sessions = makeCollection()) {
	return {
		approvals,
		sessions,
		tasks: makeCollection(),
	} as unknown as DaemonServices['collections']
}

function makeApi(
	createApproval = vi.fn((_input: unknown) => Effect.succeed({ approvalId, transactionId: 'tx-approval' })),
) {
	return makeMockDaemonApiLayer({ createApproval })
}

function approvalProgram(input: {
	readonly collections: DaemonServices['collections']
	readonly signal?: AbortSignal
	readonly toolName?: string
	readonly toolInput?: Record<string, unknown>
	readonly createApproval?: Parameters<typeof makeApi>[0]
}) {
	const createApproval =
		input.createApproval ??
		vi.fn((_approvalInput: unknown) => Effect.succeed({ approvalId, transactionId: 'tx-approval' }))
	const collections = DaemonCollectionsLive(input.collections)
	const layer = Layer.mergeAll(makeApi(createApproval), collections)
	const program = requestToolApproval({
		sessionId: 'session-1',
		toolName: input.toolName ?? 'DangerTool',
		toolInput: input.toolInput ?? { path: '/tmp/file' },
		cwd: '/repo',
		signal: input.signal ?? new AbortController().signal,
		toolUseID: 'tool-use-1',
		suggestions: [{ type: 'addRules' }],
	}).pipe(Effect.provide(layer))
	return { program, createApproval }
}

describe('Effect Claude interactive session', () => {
	it.effect('creates an approval and returns streamed applied suggestions', ({ expect }) => {
		const pending = { ...baseApproval, status: 'pending' }
		const approved = { ...baseApproval, applied_suggestions: appliedSuggestions }
		const approvals = makeCollection([], [{ type: 'update', value: approved, previousValue: pending }])
		const fixture = approvalProgram({ collections: makeCollections(approvals) })

		return fixture.program.pipe(
			Effect.andThen((result) =>
				Effect.sync(() => {
					expect(fixture.createApproval).toHaveBeenCalledWith({
						sessionId: 'session-1',
						toolName: 'DangerTool',
						toolInput: { path: '/tmp/file' },
						toolUseId: 'tool-use-1',
						agentId: undefined,
						suggestions: [{ type: 'addRules' }],
					})
					expect(result).toMatchObject({
						behavior: 'allow',
						decisionClassification: 'user_permanent',
						updatedPermissions: appliedSuggestions,
					})
					expect(approvals.unsubscribe).toHaveBeenCalledTimes(1)
				}),
			),
		)
	})

	it.effect('reuses applied rules without creating another approval', ({ expect }) => {
		const approvals = makeCollection([{ ...baseApproval, applied_suggestions: appliedSuggestions }])
		const fixture = approvalProgram({
			collections: makeCollections(approvals),
			toolName: 'Bash',
			toolInput: { command: 'git push upstream branch' },
		})

		return fixture.program.pipe(
			Effect.andThen((result) =>
				Effect.sync(() => {
					expect(result.behavior).toBe('allow')
					expect(fixture.createApproval).not.toHaveBeenCalled()
					expect(approvals.subscribeChanges).not.toHaveBeenCalled()
				}),
			),
		)
	})

	it.effect('returns a denial comment from initial synchronized state', ({ expect }) => {
		const approvals = makeCollection([{ ...baseApproval, status: 'denied', comment: 'Not permitted' }])
		const fixture = approvalProgram({ collections: makeCollections(approvals) })

		return fixture.program.pipe(
			Effect.andThen((result) =>
				Effect.sync(() => {
					expect(result).toMatchObject({
						behavior: 'deny',
						decisionClassification: 'user_reject',
						message: 'Not permitted',
					})
					expect(approvals.subscribeChanges).not.toHaveBeenCalled()
				}),
			),
		)
	})

	it.effect('denies an aborted approval and releases its listener exactly once', ({ expect }) => {
		const controller = new AbortController()
		const approvals = makeCollection()
		approvals.subscribeChanges.mockImplementation(() => {
			queueMicrotask(() => controller.abort())
			return { unsubscribe: approvals.unsubscribe }
		})
		const fixture = approvalProgram({
			collections: makeCollections(approvals),
			signal: controller.signal,
		})

		return fixture.program.pipe(
			Effect.andThen((result) =>
				Effect.sync(() => {
					expect(result).toMatchObject({
						behavior: 'deny',
						message: 'Approval cancelled due to session interrupt',
					})
					expect(approvals.unsubscribe).toHaveBeenCalledTimes(1)
				}),
			),
		)
	})

	it.effect('applies model and permission changes while recovering control failures', ({ expect }) => {
		const setModel = vi.fn(() =>
			Effect.fail(new ClaudeSdkError({ operation: 'setModel', cause: new Error('model failed') })),
		)
		const setPermissionMode = vi.fn(() => Effect.void)
		const changes = [
			{
				type: 'update' as const,
				value: { id: 'session-1', model: 'claude-opus-4-8-1m', permissions_mode: 'default' },
				previousValue: { id: 'session-1', model: 'claude-opus-4-6', permissions_mode: 'default' },
			},
			{
				type: 'update' as const,
				value: { id: 'session-1', model: 'claude-opus-4-8-1m', permissions_mode: 'bypass' },
				previousValue: { id: 'session-1', model: 'claude-opus-4-8-1m', permissions_mode: 'default' },
			},
		]
		const collections: DaemonCollectionsService = {
			current: Effect.die('unused'),
			sessionChanges: Stream.empty,
			taskChanges: Stream.empty,
			approvalChanges: Stream.empty,
			workspaceSetupChanges: Stream.empty,
			providerLoginChanges: Stream.empty,
			workspaceSetups: Stream.empty,
			workspaceSetupSessions: Stream.empty,
			streamSessionChanges: () => Stream.fromIterable(changes as never),
			streamApprovalChanges: () => Stream.never,
		}
		const sdkSession = {
			controls: { interrupt: Effect.void, setModel, setPermissionMode },
		} as unknown as ClaudeSdkSession
		const interruptState = {
			get: Effect.succeed({ wasInterrupted: false, resumeWithPrompt: null }),
			wasInterrupted: Effect.succeed(false),
			resumeWithPrompt: Effect.succeed(null),
			markInterrupted: () => Effect.void,
		}

		return observeLiveSessionControls({ sessionId: 'session-1', collections, sdkSession, interruptState }).pipe(
			Effect.andThen(
				Effect.sync(() => {
					expect(setModel).toHaveBeenCalledWith('claude-opus-4-8')
					expect(setPermissionMode).toHaveBeenCalledWith('bypassPermissions')
				}),
			),
		)
	})
})
