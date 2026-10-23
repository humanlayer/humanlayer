import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import type { DaemonServices, ORPCClient } from '@/agents/claudecode/types'
import type { TaskDiffCollectionLifecycle } from '@/effects/services/task-diff/task-diff-collection-lifecycle'
import { handleContinueSession } from '@/handlers/sessions/on-session-continue'
import { handleLaunchSession } from '@/handlers/sessions/on-session-launch'
import { processSessionChange } from '@/subscriptions'

import { createMockDaemonServices } from '../helpers/create-mock-daemon-services'
import { makeSessionChange } from '../helpers/session-fixtures'
import { UnusedWorkspaceSessionLaunchActorsLive } from '../helpers/unused-workspace-session-launch-actors'

const targetSessionId = '00000000-0000-4000-8000-000000000010'
const unrelatedSessionId = '00000000-0000-4000-8000-000000000011'

function makeAutomationServices(targetSessionId: string) {
	const updates: unknown[] = []
	const launches: string[] = []
	const continuations: string[] = []
	const services = createMockDaemonServices({
		automationTargetSessionId: targetSessionId,
		orpc: {
			sessions: {
				update: async (input: unknown) => {
					updates.push(input)
					return { success: true, transactionId: 'transaction-1' }
				},
			},
		} as unknown as ORPCClient,
		executors: {
			claude: async ({ session }) => {
				launches.push(session.id)
			},
			codelayer: async ({ session }, resumeSessionId) => {
				if (resumeSessionId === undefined) launches.push(session.id)
				else continuations.push(session.id)
			},
			fold: async () => undefined,
		},
	})
	return { continuations, launches, services, updates }
}

describe('automation target session dispatch', () => {
	test('launches only the prepared target session', async () => {
		const harness = makeAutomationServices(targetSessionId)
		await handleLaunchSession(
			makeSessionChange({
				type: 'insert',
				value: { id: unrelatedSessionId, status: 'ready_for_launch', coding_agent: 'codelayer' },
			}),
			harness.services,
		)
		await handleLaunchSession(
			makeSessionChange({
				type: 'insert',
				value: { id: targetSessionId, status: 'ready_for_launch', coding_agent: 'codelayer' },
			}),
			harness.services,
		)

		expect(harness.launches).toEqual([targetSessionId])
		expect(harness.updates).toEqual([{ sessionId: targetSessionId, status: 'launching' }])
	})

	test('continues only the prepared target session', async () => {
		const harness = makeAutomationServices(targetSessionId)
		for (const sessionId of [unrelatedSessionId, targetSessionId]) {
			await handleContinueSession(
				makeSessionChange({
					type: 'update',
					value: { id: sessionId, status: 'resuming', coding_agent: 'codelayer' },
					previousValue: { status: 'ready_for_input' },
				}),
				harness.services,
			)
		}

		expect(harness.continuations).toEqual([targetSessionId])
		expect(harness.updates).toEqual([{ sessionId: targetSessionId, status: 'running' }])
	})

	test('exposes the target constraint on the daemon service boundary', () => {
		const { services } = makeAutomationServices(targetSessionId)
		expect((services as DaemonServices).automationTargetSessionId).toBe(targetSessionId)
	})

	test('records same-status target updates as activity for persisted events and user follow-ups', async () => {
		const harness = makeAutomationServices(targetSessionId)
		const statuses: string[] = []
		harness.services.automationLifecycle = {
			awaitResult: Effect.never,
			recordSessionActivity: (status) => Effect.sync(() => statuses.push(status)),
			interrupt: Effect.void,
		}
		const taskDiffLifecycle: TaskDiffCollectionLifecycle = {
			reconcileSessionChanges: () => undefined,
			reconcileTaskChanges: () => undefined,
			reconcileAllTasks: () => undefined,
		}
		const change = makeSessionChange({
			type: 'update',
			value: { id: targetSessionId, status: 'ready_for_input' },
			previousValue: { status: 'ready_for_input' },
		})

		await Effect.runPromise(
			processSessionChange(change, harness.services, taskDiffLifecycle).pipe(
				Effect.scoped,
				Effect.provide(UnusedWorkspaceSessionLaunchActorsLive),
			),
		)

		expect(statuses).toEqual(['ready_for_input'])
	})
})
