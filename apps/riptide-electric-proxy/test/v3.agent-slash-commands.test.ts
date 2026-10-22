import { randomUUID } from 'node:crypto'

import {
	type AgentSlashCommands,
	agentSlashCommands,
	agentSlashCommandsSelectSchema,
	type NewAgentSlashCommands,
} from '@humanlayer/db/tables/agent-slash-commands'
import { createCollection, createLiveQueryCollection, eq as liveEq } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext, waitFor } from './fixtures'

const CI = !!process.env.CI

type ShapeMessage = { headers: { operation?: string; control?: string }; value?: Record<string, unknown> }

function rowKey(row: Pick<AgentSlashCommands, 'organization_id' | 'user_id' | 'host_id' | 'agent' | 'workspace_path'>) {
	return JSON.stringify([row.organization_id, row.user_id, row.host_id, row.agent, row.workspace_path])
}

async function readShape(url: URL): Promise<{ handle: string; offset: string; messages: ShapeMessage[] }> {
	const response = await fetch(url)
	expect(response.status).toBe(200)
	const handle = response.headers.get('electric-handle')
	const offset = response.headers.get('electric-offset')
	if (!handle || !offset) throw new Error('Shape response is missing electric-handle or electric-offset')
	return { handle, offset, messages: (await response.json()) as ShapeMessage[] }
}

describe.skipIf(CI)('/v3/agent-slash-commands sync tests', () => {
	let ctx: ElectricTestContext

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	test('C1: an update that leaves skills unchanged still carries the whole row', async () => {
		const testId = randomUUID().slice(0, 8)
		const owner = createTestUser(`v3_agent_commands_c1_owner_${testId}`)
		const server = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			key: `v3_agent_commands_c1_${testId}`,
		})

		const row: NewAgentSlashCommands = {
			organization_id: ctx.defaultOrganization.id,
			user_id: owner.userId,
			host_id: randomUUID(),
			agent: 'claude',
			workspace_path: `/work/${testId}`,
			commands: [{ name: 'compact' }],
			skills: [{ name: 'create-plan', description: 'Write a plan', scope: 'user' }],
		}
		await ctx.db.insert(agentSlashCommands).values(row)

		const shapeUrl = new URL(`http://localhost:${server.port}/v3/agent-slash-commands`)
		shapeUrl.searchParams.set('offset', '-1')
		let shape = await readShape(shapeUrl)
		while (!shape.messages.some((message) => message.headers.control === 'up-to-date')) {
			shapeUrl.searchParams.set('handle', shape.handle)
			shapeUrl.searchParams.set('offset', shape.offset)
			shape = await readShape(shapeUrl)
		}

		await ctx.db
			.update(agentSlashCommands)
			.set({ commands: [{ name: 'compact' }, { name: 'clear' }] })
			.where(and(eq(agentSlashCommands.host_id, row.host_id), eq(agentSlashCommands.user_id, owner.userId)))

		const liveUrl = new URL(`http://localhost:${server.port}/v3/agent-slash-commands`)
		liveUrl.searchParams.set('handle', shape.handle)
		liveUrl.searchParams.set('offset', shape.offset)
		liveUrl.searchParams.set('live', 'true')
		const live = await readShape(liveUrl)

		const update = live.messages.find(
			(message) => message.headers.operation === 'update' && message.value?.host_id === row.host_id,
		)
		expect(update?.value?.workspace_path).toBe(row.workspace_path)
		expect(JSON.parse(String(update?.value?.commands))).toEqual([{ name: 'compact' }, { name: 'clear' }])
		expect(JSON.parse(String(update?.value?.skills))).toEqual(row.skills)
	})

	test('C2: an on-demand client that never loaded a row still stores all of its columns', async () => {
		const testId = randomUUID().slice(0, 8)
		const owner = createTestUser(`v3_agent_commands_c2_owner_${testId}`)
		const server = ctx.createProxyServer({
			user: owner,
			organization: ctx.defaultOrganization,
			key: `v3_agent_commands_c2_${testId}`,
		})

		const baseRow = {
			organization_id: ctx.defaultOrganization.id,
			user_id: owner.userId,
			agent: 'claude',
			workspace_path: '',
			commands: [{ name: 'compact' }],
			skills: [{ name: 'create-plan', description: 'Write a plan', scope: 'user' as const }],
		}
		const viewedHost = { ...baseRow, host_id: randomUUID() } satisfies NewAgentSlashCommands
		const otherHost = { ...baseRow, host_id: randomUUID() } satisfies NewAgentSlashCommands
		await ctx.db.insert(agentSlashCommands).values([viewedHost, otherHost])

		const source = createCollection(
			electricCollectionOptions({
				schema: agentSlashCommandsSelectSchema,
				shapeOptions: {
					url: `http://localhost:${server.port}/v3/agent-slash-commands`,
					params: { replica: 'full' },
					subsetMethod: 'POST',
				},
				getKey: rowKey,
				syncMode: 'on-demand',
				startSync: true,
			}),
		)
		const viewedHostQuery = createLiveQueryCollection({
			query: (q) => q.from({ rows: source }).where(({ rows }) => liveEq(rows.host_id, viewedHost.host_id)),
		})
		await viewedHostQuery.preload()
		await waitFor(() => source.has(rowKey(viewedHost)), { timeout: 10_000 })
		expect(source.has(rowKey(otherHost))).toBe(false)

		await ctx.db
			.update(agentSlashCommands)
			.set({ commands: [{ name: 'compact' }, { name: 'clear' }] })
			.where(and(eq(agentSlashCommands.host_id, otherHost.host_id), eq(agentSlashCommands.user_id, owner.userId)))

		await waitFor(() => source.has(rowKey(otherHost)), { timeout: 10_000 })
		expect(source.get(rowKey(otherHost))?.skills).toEqual(otherHost.skills)

		await viewedHostQuery.cleanup()
		await source.cleanup()
	})
})
