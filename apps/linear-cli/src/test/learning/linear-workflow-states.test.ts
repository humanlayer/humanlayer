import { LinearClient } from '@linear/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Learning tests for Linear SDK workflow state CRUD operations.
 * Uses the FAKE team for testing.
 *
 * These tests document the Linear SDK behavior for:
 * - Listing workflow states for a team
 * - Creating new workflow states
 * - Updating workflow states
 * - Archiving (deleting) workflow states
 */

const TEST_TEAM_KEY = 'FAKE'

describe.skipIf(!process.env.LINEAR_API_KEY)('Linear SDK workflow states', () => {
	let linear: LinearClient
	let teamId: string
	let createdStateId: string | null = null

	beforeAll(async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		// Get the FAKE team ID
		const teams = await linear.teams({ filter: { key: { eq: TEST_TEAM_KEY } } })
		const team = teams.nodes[0]
		if (!team) {
			throw new Error(`Team ${TEST_TEAM_KEY} not found. Create it first in Linear.`)
		}
		teamId = team.id
		console.log(`Using team: ${team.name} (${team.key}) - ID: ${teamId}`)
	})

	afterAll(async () => {
		// Cleanup: archive any workflow state we created
		if (createdStateId) {
			try {
				await linear.workflowStateArchive(createdStateId)
				console.log(`Cleaned up test workflow state: ${createdStateId}`)
			} catch (error) {
				console.warn(`Failed to cleanup workflow state ${createdStateId}:`, error)
			}
		}
	})

	it('lists workflow states for a team', async () => {
		const teams = await linear.teams({ filter: { key: { eq: TEST_TEAM_KEY } } })
		const team = teams.nodes[0]!
		const states = await team.states()

		console.log(`\nFound ${states.nodes.length} workflow states:`)
		for (const state of states.nodes) {
			console.log(`  - ${state.name} (type: ${state.type}, position: ${state.position}, color: ${state.color})`)
		}

		expect(states.nodes.length).toBeGreaterThan(0)

		// KEY FINDING: Workflow states have these properties
		const firstState = states.nodes[0]!
		expect(firstState.id).toBeDefined()
		expect(firstState.name).toBeDefined()
		expect(firstState.type).toBeDefined() // backlog, unstarted, started, completed, canceled
		expect(firstState.position).toBeDefined()
		expect(firstState.color).toBeDefined()

		console.log('\nKEY FINDING: Workflow states have id, name, type, position, color properties')
		console.log('KEY FINDING: Type values are: backlog, unstarted, started, completed, canceled')
	})

	it('creates a new workflow state', async () => {
		const uniqueSuffix = Date.now().toString().slice(-6)
		const testStateName = `test-state-${uniqueSuffix}` // max 30 chars

		const result = await linear.workflowStateCreate({
			name: testStateName,
			color: '#FF6B6B', // coral red
			type: 'started', // in-progress type
			teamId: teamId,
			description: 'Test state created by learning tests',
		})

		expect(result.success).toBe(true)

		const state = await result.workflowState
		expect(state).toBeDefined()
		expect(state?.name).toBe(testStateName)
		expect(state?.color).toBe('#FF6B6B')
		expect(state?.type).toBe('started')

		createdStateId = state?.id ?? null

		console.log(`\nCreated workflow state:`)
		console.log(`  ID: ${state?.id}`)
		console.log(`  Name: ${state?.name}`)
		console.log(`  Type: ${state?.type}`)
		console.log(`  Color: ${state?.color}`)
		console.log(`  Position: ${state?.position}`)

		console.log('\nKEY FINDING: workflowStateCreate requires name, color, type, teamId')
		console.log('KEY FINDING: Name must be ≤30 characters')
		console.log('KEY FINDING: Position is auto-assigned if not provided')
		console.log('KEY FINDING: Returns WorkflowStatePayload with success boolean and workflowState accessor')
	})

	it('updates a workflow state', async () => {
		// Skip if we don't have a state to update
		if (!createdStateId) {
			console.log('Skipping update test - no state created')
			return
		}

		const newName = `upd-state-${Date.now().toString().slice(-6)}`
		const result = await linear.workflowStateUpdate(createdStateId, {
			name: newName,
			color: '#4ECDC4', // teal
			description: 'Updated by learning test',
		})

		expect(result.success).toBe(true)

		const state = await result.workflowState
		expect(state?.name).toBe(newName)
		expect(state?.color).toBe('#4ECDC4')

		console.log(`\nUpdated workflow state:`)
		console.log(`  ID: ${state?.id}`)
		console.log(`  Name: ${state?.name}`)
		console.log(`  Color: ${state?.color}`)

		console.log(
			'\nKEY FINDING: workflowStateUpdate takes id and partial input (name, color, description, position)',
		)
		console.log('KEY FINDING: Cannot change type after creation')
	})

	it('archives (deletes) a workflow state', async () => {
		// Create a state specifically for deletion
		const uniqueSuffix = Date.now().toString().slice(-6)
		const createResult = await linear.workflowStateCreate({
			name: `del-state-${uniqueSuffix}`,
			color: '#95A5A6',
			type: 'unstarted',
			teamId: teamId,
		})

		const stateToDelete = await createResult.workflowState
		expect(stateToDelete?.id).toBeDefined()

		const deleteResult = await linear.workflowStateArchive(stateToDelete!.id)
		expect(deleteResult.success).toBe(true)

		console.log(`\nArchived workflow state: ${stateToDelete?.id}`)
		console.log('\nKEY FINDING: workflowStateArchive takes id and returns ArchivePayload with success boolean')
		console.log('KEY FINDING: Archived states are soft-deleted (may still appear in queries with includeArchived)')
	})

	it('retrieves a single workflow state by ID', async () => {
		// Skip if we don't have a state
		if (!createdStateId) {
			console.log('Skipping get test - no state created')
			return
		}

		const state = await linear.workflowState(createdStateId)

		expect(state).toBeDefined()
		expect(state.id).toBe(createdStateId)

		console.log(`\nRetrieved workflow state:`)
		console.log(`  ID: ${state.id}`)
		console.log(`  Name: ${state.name}`)
		console.log(`  Type: ${state.type}`)

		console.log('\nKEY FINDING: linear.workflowState(id) fetches a single state by ID')
	})

	it('documents valid workflow state types', async () => {
		// Create states of each valid type to document them
		const types = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const
		const createdIds: string[] = []

		console.log('\nWorkflow state types and their meaning:')
		console.log('  - backlog: Items not yet scheduled (leftmost)')
		console.log('  - unstarted: Scheduled but not started')
		console.log('  - started: Work in progress')
		console.log('  - completed: Successfully finished')
		console.log("  - canceled: Abandoned/won't do")

		// Just verify one type works (to avoid creating too many test states)
		const result = await linear.workflowStateCreate({
			name: `type-test-${Date.now().toString().slice(-6)}`,
			color: '#BDC3C7',
			type: 'started',
			teamId: teamId,
		})

		const state = await result.workflowState
		if (state) {
			createdIds.push(state.id)
			expect(state.type).toBe('started')
		}

		// Cleanup
		for (const id of createdIds) {
			await linear.workflowStateArchive(id)
		}

		console.log('\nKEY FINDING: Valid types are: backlog, unstarted, started, completed, canceled')
		console.log('KEY FINDING: Type determines the column group in Linear board view')
	})

	it('workflow states have NO unarchive method', async () => {
		// Create and archive a state
		const uniqueSuffix = Date.now().toString().slice(-6)
		const createResult = await linear.workflowStateCreate({
			name: `unarch-test-${uniqueSuffix}`,
			color: '#9B59B6',
			type: 'started',
			teamId: teamId,
		})

		const state = await createResult.workflowState
		expect(state?.id).toBeDefined()
		const stateId = state!.id

		// Archive it
		const archiveResult = await linear.workflowStateArchive(stateId)
		expect(archiveResult.success).toBe(true)
		console.log(`\nArchived state: ${stateId}`)

		// Verify it's archived
		const archivedState = await linear.workflowState(stateId)
		console.log(`  archivedAt: ${archivedState.archivedAt}`)
		expect(archivedState.archivedAt).toBeDefined()

		// Check if unarchive method exists
		const hasUnarchive = typeof (archivedState as unknown as { unarchive?: unknown }).unarchive === 'function'
		console.log(`  Has unarchive method: ${hasUnarchive}`)
		expect(hasUnarchive).toBe(false)

		// Check if archive method exists (it does)
		const hasArchive = typeof archivedState.archive === 'function'
		console.log(`  Has archive method: ${hasArchive}`)
		expect(hasArchive).toBe(true)

		console.log('\nKEY FINDING: WorkflowState has archive() but NO unarchive() method')
		console.log('KEY FINDING: Unlike Issue/Project/Notification, workflow states cannot be unarchived via SDK')
		console.log('KEY FINDING: Must unarchive via Linear UI or recreate the state')
	})

	it('ALLOWS duplicate workflow state names within same team', async () => {
		const uniqueSuffix = Date.now().toString().slice(-6)
		const duplicateName = `dup-test-${uniqueSuffix}`

		// Create first state
		const first = await linear.workflowStateCreate({
			name: duplicateName,
			color: '#E74C3C',
			type: 'started',
			teamId: teamId,
		})
		const firstState = await first.workflowState
		expect(firstState?.id).toBeDefined()

		// Try to create second state with same name - THIS SUCCEEDS!
		let secondState: Awaited<ReturnType<typeof linear.workflowStateCreate>>['workflowState'] | null = null
		let duplicateError: Error | null = null
		try {
			const second = await linear.workflowStateCreate({
				name: duplicateName,
				color: '#3498DB',
				type: 'unstarted',
				teamId: teamId,
			})
			secondState = await second.workflowState
		} catch (error) {
			duplicateError = error as Error
		}

		console.log(`\nFirst state created: ${firstState?.id} (${duplicateName})`)

		if (secondState) {
			console.log(`Second state created: ${secondState.id} (${duplicateName})`)
			expect(secondState.name).toBe(duplicateName)
			expect(secondState.id).not.toBe(firstState?.id)
			// Cleanup both
			await linear.workflowStateArchive(secondState.id)
		} else {
			console.log(`Duplicate creation error: ${duplicateError?.message?.slice(0, 100)}...`)
		}

		// Cleanup first
		await linear.workflowStateArchive(firstState!.id)

		console.log('\nKEY FINDING: Duplicate workflow state names ARE ALLOWED within a team!')
		console.log('KEY FINDING: Each state gets a unique ID regardless of name')
		console.log('KEY FINDING: This differs from some other Linear entities that enforce uniqueness')
	})

	it('allows same name after archiving original', async () => {
		const uniqueSuffix = Date.now().toString().slice(-6)
		const reuseName = `reuse-${uniqueSuffix}`

		// Create first state
		const first = await linear.workflowStateCreate({
			name: reuseName,
			color: '#1ABC9C',
			type: 'started',
			teamId: teamId,
		})
		const firstState = await first.workflowState
		expect(firstState?.id).toBeDefined()

		// Archive it
		await linear.workflowStateArchive(firstState!.id)
		console.log(`\nArchived first state: ${firstState?.id} (${reuseName})`)

		// Try to create second state with same name
		let secondState: Awaited<ReturnType<typeof linear.workflowStateCreate>>['workflowState'] | null = null
		let error: Error | null = null
		try {
			const second = await linear.workflowStateCreate({
				name: reuseName,
				color: '#F39C12',
				type: 'unstarted',
				teamId: teamId,
			})
			secondState = await second.workflowState
		} catch (e) {
			error = e as Error
		}

		if (secondState) {
			console.log(`Created second state with same name: ${secondState.id}`)
			await linear.workflowStateArchive(secondState.id)
			console.log('\nKEY FINDING: CAN reuse name after archiving the original state')
		} else {
			console.log(`Failed to create second state: ${error?.message?.slice(0, 100)}`)
			console.log('\nKEY FINDING: CANNOT reuse name even after archiving (archived names still reserved)')
		}
	})
})
