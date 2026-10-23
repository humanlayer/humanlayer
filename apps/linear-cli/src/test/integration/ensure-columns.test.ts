import * as path from 'node:path'

import { LinearClient } from '@linear/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	type ColumnsConfig,
	executeEnsureColumnsPlan,
	loadColumnsConfig,
	planDestroyColumns,
	planEnsureColumns,
	validateColumn,
} from '../../commands/ensureColumns'

const TEST_TEAM_KEY = 'FAKE'
const FIXTURES_DIR = path.join(import.meta.dirname, '../fixtures')

describe.skipIf(!process.env.LINEAR_API_KEY)('ensure-columns integration', () => {
	let linear: LinearClient
	let teamId: string
	const createdStateIds: string[] = []

	beforeAll(async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		// Get team ID for cleanup
		const teams = await linear.teams({ filter: { key: { eq: TEST_TEAM_KEY } } })
		const team = teams.nodes[0]
		if (!team) {
			throw new Error(`Team ${TEST_TEAM_KEY} not found`)
		}
		teamId = team.id
		console.log(`Using team: ${team.name} (${team.key})`)
	})

	afterAll(async () => {
		// Cleanup: archive all created states
		for (const id of createdStateIds) {
			try {
				await linear.workflowStateArchive(id)
				console.log(`Cleaned up: ${id}`)
			} catch {
				console.warn(`Failed to cleanup: ${id}`)
			}
		}
	})

	describe('loadColumnsConfig', () => {
		it('loads valid YAML config', () => {
			const configPath = path.join(FIXTURES_DIR, 'test-columns.yaml')
			const config = loadColumnsConfig(configPath)

			expect(config.columns).toBeDefined()
			expect(config.columns.length).toBe(3)
			expect(config.columns[0]?.name).toBe('ready-for-questions')
			expect(config.columns[0]?.color).toBe('#5C9BC0')
			expect(config.columns[0]?.type).toBe('started')
		})

		it('throws on missing file', () => {
			expect(() => loadColumnsConfig('/nonexistent/path.yaml')).toThrow('Config file not found')
		})
	})

	describe('validateColumn', () => {
		it('accepts valid column', () => {
			const error = validateColumn({ name: 'test-column', color: '#FF0000', type: 'started' })
			expect(error).toBeNull()
		})

		it('rejects name over 30 chars', () => {
			const error = validateColumn({ name: 'a'.repeat(31), color: '#FF0000' })
			expect(error).toContain('1-30 chars')
		})

		it('rejects invalid color format', () => {
			const error = validateColumn({ name: 'test', color: 'red' })
			expect(error).toContain('#RRGGBB')
		})

		it('rejects invalid type', () => {
			const error = validateColumn({ name: 'test', color: '#FF0000', type: 'invalid' as 'started' })
			expect(error).toContain('Invalid type')
		})

		it('defaults type to started', () => {
			const error = validateColumn({ name: 'test', color: '#FF0000' })
			expect(error).toBeNull()
		})
	})

	describe('planEnsureColumns', () => {
		it('plans to create new columns', async () => {
			const config: ColumnsConfig = {
				columns: [{ name: `plan-test-${Date.now()}`, color: '#FF0000', type: 'started' }],
			}

			const plan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)

			expect(plan.teamKey).toBe(TEST_TEAM_KEY)
			expect(plan.actions.length).toBe(1)
			expect(plan.actions[0]?.action).toBe('create')
		})

		it('plans to skip unchanged existing columns', async () => {
			// First create a column we control
			const uniqueSuffix = Date.now().toString().slice(-6)
			const testName = `skip-test-${uniqueSuffix}`
			const config: ColumnsConfig = {
				columns: [{ name: testName, color: '#FF0000', type: 'started' }],
			}

			// Create it first
			const createPlan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)
			for await (const r of executeEnsureColumnsPlan(linear, createPlan)) {
				expect(r.success).toBe(true)
			}

			// Now plan again - should skip since no changes
			const plan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)

			expect(plan.actions.length).toBe(1)
			expect(plan.actions[0]?.action).toBe('skip')
			expect(plan.actions[0]?.reason).toBe('No changes')

			// Cleanup
			const states = await linear.workflowStates({ filter: { name: { eq: testName } } })
			const state = states.nodes[0]
			if (state) {
				createdStateIds.push(state.id)
			}
		})

		it('plans to update existing columns with different color', async () => {
			// "Todo" is a default Linear column - it exists with different color
			const config: ColumnsConfig = {
				columns: [{ name: 'Todo', color: '#FF0000', type: 'unstarted' }],
			}

			const plan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)

			expect(plan.actions.length).toBe(1)
			expect(plan.actions[0]?.action).toBe('update')
			expect(plan.actions[0]?.diff?.color).toBeDefined()
		})

		it('reports validation errors in plan', async () => {
			const config: ColumnsConfig = {
				columns: [{ name: 'a'.repeat(31), color: '#FF0000' }],
			}

			const plan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)

			expect(plan.actions[0]?.action).toBe('error')
			expect(plan.actions[0]?.reason).toContain('1-30 chars')
		})

		it('throws on invalid team', async () => {
			const config: ColumnsConfig = { columns: [] }

			await expect(planEnsureColumns(linear, 'NONEXISTENT', config)).rejects.toThrow('not found')
		})
	})

	describe('executeEnsureColumnsPlan', () => {
		it('creates columns and returns results', async () => {
			const uniqueSuffix = Date.now().toString().slice(-6)
			const config: ColumnsConfig = {
				columns: [
					{
						name: `exec-test-${uniqueSuffix}`,
						color: '#E91E63',
						type: 'started',
						description: 'Test column',
					},
				],
			}

			const plan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)
			expect(plan.actions[0]?.action).toBe('create')

			const results: Array<{ success: boolean; column: string; error?: string }> = []
			for await (const result of executeEnsureColumnsPlan(linear, plan)) {
				results.push(result)
			}

			expect(results.length).toBe(1)
			expect(results[0]?.success).toBe(true)
			expect(results[0]?.column).toBe(`exec-test-${uniqueSuffix}`)

			// Track for cleanup
			const states = await linear.workflowStates({ filter: { name: { eq: `exec-test-${uniqueSuffix}` } } })
			const state = states.nodes[0]
			if (state) {
				createdStateIds.push(state.id)
			}
		})

		it('executes update actions for changed columns', async () => {
			// Create a column first
			const uniqueSuffix = Date.now().toString().slice(-6)
			const testName = `upd-exec-${uniqueSuffix}`
			const config: ColumnsConfig = {
				columns: [{ name: testName, color: '#FF0000', type: 'started' }],
			}

			// Create it
			const createPlan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)
			for await (const r of executeEnsureColumnsPlan(linear, createPlan)) {
				expect(r.success).toBe(true)
			}

			// Now update the color
			const updateConfig: ColumnsConfig = {
				columns: [{ name: testName, color: '#00FF00', type: 'started' }],
			}

			const updatePlan = await planEnsureColumns(linear, TEST_TEAM_KEY, updateConfig)
			expect(updatePlan.actions[0]?.action).toBe('update')

			const results: Array<{ success: boolean; column: string; action: string }> = []
			for await (const result of executeEnsureColumnsPlan(linear, updatePlan)) {
				results.push(result)
			}

			expect(results.length).toBe(1)
			expect(results[0]?.success).toBe(true)
			expect(results[0]?.action).toBe('update')

			// Cleanup
			const states = await linear.workflowStates({ filter: { name: { eq: testName } } })
			const state = states.nodes[0]
			if (state) {
				createdStateIds.push(state.id)
			}
		})
	})

	describe('full workflow with test-columns.yaml', () => {
		it('creates the three test columns', async () => {
			// Make column names unique for this test run
			const uniqueSuffix = Date.now().toString().slice(-6)
			const config: ColumnsConfig = {
				columns: [
					{ name: `rdy-ques-${uniqueSuffix}`, color: '#5C6BC0', type: 'started' },
					{ name: `ques-prog-${uniqueSuffix}`, color: '#F7DC6F', type: 'started' },
					{ name: `ques-rev-${uniqueSuffix}`, color: '#81C784', type: 'started' },
				],
			}

			// Plan
			const plan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)

			console.log('\nPlan:')
			for (const action of plan.actions) {
				console.log(`  ${action.action}: ${action.column.name}`)
			}

			expect(plan.actions.length).toBe(3)
			expect(plan.actions.every((a) => a.action === 'create')).toBe(true)

			// Execute
			const results: Array<{ success: boolean; column: string; error?: string }> = []
			for await (const result of executeEnsureColumnsPlan(linear, plan)) {
				console.log(`  ${result.success ? '✓' : '✗'} ${result.column}`)
				results.push(result)
			}

			expect(results.length).toBe(3)
			expect(results.every((r) => r.success)).toBe(true)

			// Verify columns exist
			const teams = await linear.teams({ filter: { key: { eq: TEST_TEAM_KEY } } })
			const team = teams.nodes[0]!
			const states = await team.states()
			const stateNames = states.nodes.map((s) => s.name)

			for (const col of config.columns) {
				expect(stateNames).toContain(col.name)

				// Track for cleanup
				const state = states.nodes.find((s) => s.name === col.name)
				if (state) {
					createdStateIds.push(state.id)
				}
			}

			console.log('\nKEY FINDING: Full workflow creates all three columns successfully')
		})

		it('is idempotent - running again skips existing', async () => {
			const uniqueSuffix = Date.now().toString().slice(-6)
			const config: ColumnsConfig = {
				columns: [{ name: `idemp-${uniqueSuffix}`, color: '#9C27B0', type: 'started' }],
			}

			// First run - creates
			const plan1 = await planEnsureColumns(linear, TEST_TEAM_KEY, config)
			expect(plan1.actions[0]?.action).toBe('create')

			for await (const result of executeEnsureColumnsPlan(linear, plan1)) {
				expect(result.success).toBe(true)

				// Track for cleanup
				const states = await linear.workflowStates({ filter: { name: { eq: result.column } } })
				const state = states.nodes[0]
				if (state) createdStateIds.push(state.id)
			}

			// Second run - skips
			const plan2 = await planEnsureColumns(linear, TEST_TEAM_KEY, config)
			expect(plan2.actions[0]?.action).toBe('skip')
			expect(plan2.actions[0]?.reason).toBe('No changes')

			console.log('\nKEY FINDING: Command is idempotent - safe to run multiple times')
		})
	})

	describe('planDestroyColumns', () => {
		it('plans to destroy existing columns', async () => {
			// First create a column to destroy
			const uniqueSuffix = Date.now().toString().slice(-6)
			const columnName = `destroy-test-${uniqueSuffix}`
			const config: ColumnsConfig = {
				columns: [{ name: columnName, color: '#FF5722', type: 'started' }],
			}

			// Create it
			const createPlan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)
			for await (const result of executeEnsureColumnsPlan(linear, createPlan)) {
				expect(result.success).toBe(true)
			}

			// Plan destroy
			const destroyPlan = await planDestroyColumns(linear, TEST_TEAM_KEY, config)

			expect(destroyPlan.mode).toBe('destroy')
			expect(destroyPlan.actions.length).toBe(1)
			expect(destroyPlan.actions[0]?.action).toBe('destroy')
			expect(destroyPlan.actions[0]?.stateId).toBeDefined()
			expect(destroyPlan.actions[0]?.column.name).toBe(columnName)

			// Execute destroy (cleanup happens here)
			for await (const result of executeEnsureColumnsPlan(linear, destroyPlan)) {
				expect(result.success).toBe(true)
				console.log(`  Destroyed: ${result.column}`)
			}

			console.log('\nKEY FINDING: planDestroyColumns correctly identifies columns to archive')
		})

		it('plans to skip missing columns', async () => {
			const config: ColumnsConfig = {
				columns: [{ name: `nonexistent-${Date.now()}`, color: '#FF0000' }],
			}

			const plan = await planDestroyColumns(linear, TEST_TEAM_KEY, config)

			expect(plan.mode).toBe('destroy')
			expect(plan.actions[0]?.action).toBe('skip_missing')
			expect(plan.actions[0]?.reason).toBe('Does not exist')

			console.log('\nKEY FINDING: planDestroyColumns skips columns that do not exist')
		})
	})

	describe('full destroy workflow', () => {
		it('creates and then destroys columns', async () => {
			const uniqueSuffix = Date.now().toString().slice(-6)
			const config: ColumnsConfig = {
				columns: [
					{ name: `del-a-${uniqueSuffix}`, color: '#E91E63', type: 'started' },
					{ name: `del-b-${uniqueSuffix}`, color: '#9C27B0', type: 'started' },
				],
			}

			// Create
			console.log('\nCreating columns...')
			const createPlan = await planEnsureColumns(linear, TEST_TEAM_KEY, config)
			expect(createPlan.mode).toBe('ensure')
			expect(createPlan.actions.every((a) => a.action === 'create')).toBe(true)

			for await (const result of executeEnsureColumnsPlan(linear, createPlan)) {
				expect(result.success).toBe(true)
				console.log(`  Created: ${result.column}`)
			}

			// Verify they exist
			const teams = await linear.teams({ filter: { key: { eq: TEST_TEAM_KEY } } })
			const team = teams.nodes[0]!
			let states = await team.states()
			let stateNames = states.nodes.map((s) => s.name)

			for (const col of config.columns) {
				expect(stateNames).toContain(col.name)
			}

			// Destroy
			console.log('\nDestroying columns...')
			const destroyPlan = await planDestroyColumns(linear, TEST_TEAM_KEY, config)
			expect(destroyPlan.mode).toBe('destroy')
			expect(destroyPlan.actions.every((a) => a.action === 'destroy')).toBe(true)

			for await (const result of executeEnsureColumnsPlan(linear, destroyPlan)) {
				expect(result.success).toBe(true)
				console.log(`  Archived: ${result.column}`)
			}

			// Verify they no longer appear in active states
			states = await team.states()
			stateNames = states.nodes.filter((s) => !s.archivedAt).map((s) => s.name)

			for (const col of config.columns) {
				expect(stateNames).not.toContain(col.name)
			}

			console.log('\nKEY FINDING: Full create → destroy workflow works correctly')
		}, 30000)
	})
})
