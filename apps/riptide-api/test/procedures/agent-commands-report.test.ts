import {
	type AgentCommand,
	type AgentSkill,
	agentSlashCommands,
	HOST_LEVEL_WORKSPACE_PATH,
} from '@humanlayer/db/tables/agent-slash-commands'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import { and, eq, ne } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { reportAgentCommandsProcedure as liveReportProcedure } from '../../src/orpc/daemon/agent-commands/report.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const MAX_WORKSPACE_ROWS_PER_HOST = 20

describe('daemon/agent-commands/report (effect)', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let reportProcedure: typeof liveReportProcedure

	let organizationId: string
	const workosOrganizationId = 'org_agent_commands_report'
	const userId = 'user_agent_commands_report'
	const hostId = 'agent-slash-commands-report'

	const commands = [{ name: 'compact', description: 'Summarize' }]
	const skills = [{ name: 'ui-copy', description: 'Copy rules', scope: 'user' as const }]

	const report = (input: {
		workspacePath?: string
		auth?: { hostId: string }
		commands?: AgentCommand[]
		skills?: AgentSkill[]
		keepExistingCommands?: boolean
	}) =>
		call(
			reportProcedure,
			{
				hostId,
				agent: 'claude',
				commands: input.commands ?? commands,
				skills: input.skills ?? skills,
				...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
				keepExistingCommands: input.keepExistingCommands ?? false,
			},
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId, organizationId, hostId: input.auth?.hostId ?? hostId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)

	const workspaceRows = () =>
		db
			.select({ workspace_path: agentSlashCommands.workspace_path, updated_at: agentSlashCommands.updated_at })
			.from(agentSlashCommands)
			.where(
				and(
					eq(agentSlashCommands.host_id, hostId),
					ne(agentSlashCommands.workspace_path, HOST_LEVEL_WORKSPACE_PATH),
				),
			)

	const seedWorkspaceRow = (workspacePath: string, updatedAt: number) =>
		db.insert(agentSlashCommands).values({
			organization_id: organizationId,
			user_id: userId,
			host_id: hostId,
			agent: 'claude',
			workspace_path: workspacePath,
			commands,
			skills,
			updated_at: BigInt(updatedAt),
		})

	beforeAll(async () => {
		const testDb = await createTestDb('agent_commands_report')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		reportProcedure = bindProcedureToRuntime(liveReportProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'agent commands report org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 60000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	beforeEach(async () => {
		await db.delete(agentSlashCommands).where(eq(agentSlashCommands.host_id, hostId))
	})

	test('rejects a report whose hostId disagrees with the daemon token', async () => {
		await expect(report({ workspacePath: '/tmp/one', auth: { hostId: 'other-host' } })).rejects.toThrow()
		expect(await workspaceRows()).toHaveLength(0)
	})

	test('upserts a workspace row and leaves the host row untouched', async () => {
		await report({})
		await report({ workspacePath: '/tmp/project' })
		await report({ workspacePath: '/tmp/project' })

		const all = await db.select().from(agentSlashCommands).where(eq(agentSlashCommands.host_id, hostId))
		expect(all).toHaveLength(2)
		expect(all.filter((row) => row.workspace_path === HOST_LEVEL_WORKSPACE_PATH)).toHaveLength(1)
		expect(all.filter((row) => row.workspace_path === '/tmp/project')).toHaveLength(1)
	})

	test('caps workspace rows at the most recent per host, dropping the oldest', async () => {
		for (let index = 0; index < MAX_WORKSPACE_ROWS_PER_HOST + 2; index++) {
			await seedWorkspaceRow(`/tmp/seed-${index}`, 1000 + index)
		}

		await report({ workspacePath: '/tmp/newest' })

		const rows = await workspaceRows()
		expect(rows).toHaveLength(MAX_WORKSPACE_ROWS_PER_HOST)
		const paths = new Set(rows.map((row) => row.workspace_path))
		expect(paths.has('/tmp/newest')).toBe(true)
		// 22 seeds plus the newly reported path is 23 rows, so the 3 oldest seeds fall off.
		expect(paths.has('/tmp/seed-0')).toBe(false)
		expect(paths.has('/tmp/seed-1')).toBe(false)
		expect(paths.has('/tmp/seed-2')).toBe(false)
		expect(paths.has('/tmp/seed-3')).toBe(true)
	})

	test('a host-level report trims accumulated workspace rows', async () => {
		for (let index = 0; index < MAX_WORKSPACE_ROWS_PER_HOST + 5; index++) {
			await seedWorkspaceRow(`/tmp/stale-${index}`, 1000 + index)
		}

		await report({})

		expect(await workspaceRows()).toHaveLength(MAX_WORKSPACE_ROWS_PER_HOST)
		const hostRow = await db
			.select()
			.from(agentSlashCommands)
			.where(
				and(
					eq(agentSlashCommands.host_id, hostId),
					eq(agentSlashCommands.workspace_path, HOST_LEVEL_WORKSPACE_PATH),
				),
			)
		expect(hostRow).toHaveLength(1)
	})

	test('re-reporting an older workspace refreshes it so it survives the cap', async () => {
		await seedWorkspaceRow('/tmp/rescued', 1)
		for (let index = 0; index < MAX_WORKSPACE_ROWS_PER_HOST; index++) {
			await seedWorkspaceRow(`/tmp/fresh-${index}`, 2000 + index)
		}

		// /tmp/rescued is the oldest, so it would be evicted — reporting it makes it the newest.
		await report({ workspacePath: '/tmp/rescued' })

		const paths = new Set((await workspaceRows()).map((row) => row.workspace_path))
		expect(paths.has('/tmp/rescued')).toBe(true)
		expect(paths.has('/tmp/fresh-0')).toBe(false)
	})

	const storedRow = async (workspacePath: string) => {
		const [row] = await db
			.select({ commands: agentSlashCommands.commands, skills: agentSlashCommands.skills })
			.from(agentSlashCommands)
			.where(and(eq(agentSlashCommands.host_id, hostId), eq(agentSlashCommands.workspace_path, workspacePath)))
		return row
	}

	const diskCommands = [{ name: 'repo-command', scope: 'project' as const }]
	const diskSkills = [{ name: 'repo-skill', scope: 'project' as const }]

	test('a disk-only report keeps the commands a session stored and refreshes skills', async () => {
		await report({ workspacePath: '/tmp/kept' })

		await report({
			workspacePath: '/tmp/kept',
			commands: diskCommands,
			skills: diskSkills,
			keepExistingCommands: true,
		})

		expect(await storedRow('/tmp/kept')).toEqual({ commands, skills: diskSkills })
	})

	test('a disk-only report stores its commands for a directory no session reported', async () => {
		await report({
			workspacePath: '/tmp/unreported',
			commands: diskCommands,
			skills: diskSkills,
			keepExistingCommands: true,
		})

		expect(await storedRow('/tmp/unreported')).toEqual({ commands: diskCommands, skills: diskSkills })
	})
})
