import * as readline from 'node:readline'

import type { LinearClient } from '@linear/sdk'
import { file } from 'bun'
import chalk from 'chalk'
import * as yaml from 'yaml'

// ============================================================================
// Types
// ============================================================================

export interface ColumnDefinition {
	name: string
	description?: string
	color: string
	type?: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
}

export interface ColumnsConfig {
	columns: ColumnDefinition[]
}

// ============================================================================
// RPI Workflow Defaults (18 columns)
// ============================================================================

/**
 * Default columns for the RPI (Research-Plan-Implement) workflow.
 * These create the full state machine for Linear-based task management.
 * All columns are 'started' type (In Progress section).
 *
 * Color scheme (each darkens by 20 RGB per phase - lighter = earlier, darker = more done):
 * - ready-for-*: Indigo shades (#9EAAFF -> #3A469B)
 * - *-in-progress: Yellow shades (#FFEB3B -> #9B8700)
 * - *-in-review: Mint shades (#D2FACF -> #6E966B)
 */
export const RPI_DEFAULT_COLUMNS: ColumnsConfig = {
	columns: [
		// Phase 1: Questions
		{
			name: 'ready-for-questions',
			color: '#9EAAFF',
			type: 'started',
			description: 'Waiting for research questions generation',
		},
		{
			name: 'questions-in-progress',
			color: '#FFEB3B',
			type: 'started',
			description: 'Generating research questions',
		},
		{
			name: 'questions-in-review',
			color: '#D2FACF',
			type: 'started',
			description: 'Research questions ready for human review',
		},

		// Phase 2: Research
		{ name: 'ready-for-research', color: '#8A96EB', type: 'started', description: 'Waiting for research' },
		{ name: 'research-in-progress', color: '#EBD727', type: 'started', description: 'Conducting research' },
		{
			name: 'research-in-review',
			color: '#BEE6BB',
			type: 'started',
			description: 'Research ready for human review',
		},

		// Phase 3: Design
		{ name: 'ready-for-design', color: '#7682D7', type: 'started', description: 'Waiting for design discussion' },
		{ name: 'design-in-progress', color: '#D7C313', type: 'started', description: 'Creating design discussion' },
		{ name: 'design-in-review', color: '#AAD2A7', type: 'started', description: 'Design ready for human review' },

		// Phase 4: Structure
		{
			name: 'ready-for-structure',
			color: '#626EC3',
			type: 'started',
			description: 'Waiting for structure outline',
		},
		{ name: 'structure-in-progress', color: '#C3AF00', type: 'started', description: 'Creating structure outline' },
		{
			name: 'structure-in-review',
			color: '#96BE93',
			type: 'started',
			description: 'Structure ready for human review',
		},

		// Phase 5: Plan
		{ name: 'ready-for-plan', color: '#4E5AAF', type: 'started', description: 'Waiting for implementation plan' },
		{ name: 'plan-in-progress', color: '#AF9B00', type: 'started', description: 'Creating implementation plan' },
		{ name: 'plan-in-review', color: '#82AA7F', type: 'started', description: 'Plan ready for human review' },

		// Phase 6: Dev
		{ name: 'ready-for-dev', color: '#3A469B', type: 'started', description: 'Ready for implementation' },
		{ name: 'in-dev', color: '#9B8700', type: 'started', description: 'Implementation in progress' },
		{ name: 'code-review', color: '#6E966B', type: 'started', description: 'Code ready for review' },
	],
}

export interface ColumnDiff {
	color?: { from: string; to: string }
	description?: { from: string | undefined; to: string | undefined }
}

export interface PlanAction {
	action: 'create' | 'update' | 'skip' | 'skip_missing' | 'destroy' | 'destroy_extra' | 'error'
	column: ColumnDefinition
	stateId?: string // for update/destroy actions
	reason?: string
	diff?: ColumnDiff // for update actions
}

export interface EnsureColumnsPlan {
	teamId: string
	teamKey: string
	teamName: string
	mode: 'ensure' | 'destroy' | 'sync'
	actions: PlanAction[]
}

export interface ExecuteResult {
	success: boolean
	column: string
	error?: string
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Load and parse columns config from YAML file
 */
export async function loadColumnsConfig(configPath: string): Promise<ColumnsConfig> {
	if (!(await file(configPath).exists())) {
		throw new Error(`Config file not found: ${configPath}`)
	}

	const content = await file(configPath).text()
	const config = yaml.parse(content) as ColumnsConfig

	if (!config.columns || !Array.isArray(config.columns)) {
		throw new Error('Invalid config: expected "columns" array')
	}

	return config
}

/**
 * Validate a column definition, returns error message or null if valid
 */
export function validateColumn(column: ColumnDefinition): string | null {
	if (!column.name || column.name.length > 30) {
		return `Invalid name: "${column.name}" (must be 1-30 chars)`
	}

	if (!column.color || !/^#[0-9A-Fa-f]{6}$/.test(column.color)) {
		return `Invalid color: "${column.color}" (must be #RRGGBB)`
	}

	const validTypes = ['backlog', 'unstarted', 'started', 'completed', 'canceled']
	const columnType = column.type || 'started'
	if (!validTypes.includes(columnType)) {
		return `Invalid type: "${columnType}"`
	}

	return null
}

// ============================================================================
// Plan Phase
// ============================================================================

export interface PlanOptions {
	removeOtherColumns?: boolean
}

/**
 * Generate a plan for ensuring columns exist
 */
export async function planEnsureColumns(
	linear: LinearClient,
	teamKey: string,
	config: ColumnsConfig,
	options: PlanOptions = {},
): Promise<EnsureColumnsPlan> {
	const normalizedKey = teamKey.toUpperCase()
	const teams = await linear.teams({ filter: { key: { eq: normalizedKey } } })
	const team = teams.nodes[0]

	if (!team) {
		throw new Error(`Team "${normalizedKey}" not found.`)
	}

	const existingStates = await team.states()
	const statesByName = new Map(existingStates.nodes.map((s) => [s.name.toLowerCase(), s]))

	const actions: PlanAction[] = []
	const configColumnNames = new Set(config.columns.map((c) => c.name.toLowerCase()))

	for (const column of config.columns) {
		// Validate
		const validationError = validateColumn(column)
		if (validationError) {
			actions.push({ action: 'error', column, reason: validationError })
			continue
		}

		const existingState = statesByName.get(column.name.toLowerCase())

		if (existingState) {
			// Check for differences
			const diff: ColumnDiff = {}
			let hasDiff = false

			// Compare color (case-insensitive)
			if (existingState.color.toLowerCase() !== column.color.toLowerCase()) {
				diff.color = { from: existingState.color, to: column.color }
				hasDiff = true
			}

			// Compare description
			const existingDesc = existingState.description || undefined
			const newDesc = column.description || undefined
			if (existingDesc !== newDesc) {
				diff.description = { from: existingDesc, to: newDesc }
				hasDiff = true
			}

			if (hasDiff) {
				actions.push({
					action: 'update',
					column,
					stateId: existingState.id,
					diff,
				})
			} else {
				actions.push({ action: 'skip', column, reason: 'No changes' })
			}
		} else {
			actions.push({ action: 'create', column })
		}
	}

	// If removeOtherColumns is set, find columns in 'started' type not in config
	if (options.removeOtherColumns) {
		for (const state of existingStates.nodes) {
			// Only remove 'started' type columns not in config
			if (state.type === 'started' && !configColumnNames.has(state.name.toLowerCase())) {
				actions.push({
					action: 'destroy_extra',
					column: { name: state.name, color: state.color, type: 'started' },
					stateId: state.id,
					reason: 'Not in config',
				})
			}
		}
	}

	return {
		teamId: team.id,
		teamKey: normalizedKey,
		teamName: team.name,
		mode: options.removeOtherColumns ? 'sync' : 'ensure',
		actions,
	}
}

/**
 * Generate a plan for destroying (archiving) columns
 */
export async function planDestroyColumns(
	linear: LinearClient,
	teamKey: string,
	config: ColumnsConfig,
): Promise<EnsureColumnsPlan> {
	const normalizedKey = teamKey.toUpperCase()
	const teams = await linear.teams({ filter: { key: { eq: normalizedKey } } })
	const team = teams.nodes[0]

	if (!team) {
		throw new Error(`Team "${normalizedKey}" not found.`)
	}

	const existingStates = await team.states()
	const statesByName = new Map(existingStates.nodes.map((s) => [s.name.toLowerCase(), s]))

	const actions: PlanAction[] = []

	for (const column of config.columns) {
		const existingState = statesByName.get(column.name.toLowerCase())

		if (existingState) {
			actions.push({
				action: 'destroy',
				column,
				stateId: existingState.id,
			})
		} else {
			actions.push({
				action: 'skip_missing',
				column,
				reason: 'Does not exist',
			})
		}
	}

	return {
		teamId: team.id,
		teamKey: normalizedKey,
		teamName: team.name,
		mode: 'destroy',
		actions,
	}
}

// ============================================================================
// Execute Phase
// ============================================================================

export interface ExecuteResultWithAction extends ExecuteResult {
	action: PlanAction['action']
}

/**
 * Execute a plan, yielding results as they complete
 */
export async function* executeEnsureColumnsPlan(
	linear: LinearClient,
	plan: EnsureColumnsPlan,
): AsyncGenerator<ExecuteResultWithAction> {
	for (const action of plan.actions) {
		if (action.action === 'create') {
			const column = action.column
			const columnType = column.type || 'started'

			try {
				const result = await linear.workflowStateCreate({
					name: column.name,
					color: column.color,
					type: columnType,
					teamId: plan.teamId,
					description: column.description,
				})

				if (result.success) {
					yield { success: true, column: column.name, action: 'create' }
				} else {
					yield { success: false, column: column.name, error: 'Create returned false', action: 'create' }
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error)
				yield { success: false, column: column.name, error: msg, action: 'create' }
			}
		} else if (action.action === 'update' && action.stateId) {
			const column = action.column
			try {
				const result = await linear.workflowStateUpdate(action.stateId, {
					color: column.color,
					description: column.description,
				})

				if (result.success) {
					yield { success: true, column: column.name, action: 'update' }
				} else {
					yield { success: false, column: column.name, error: 'Update returned false', action: 'update' }
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error)
				yield { success: false, column: column.name, error: msg, action: 'update' }
			}
		} else if ((action.action === 'destroy' || action.action === 'destroy_extra') && action.stateId) {
			try {
				const result = await linear.workflowStateArchive(action.stateId)

				if (result.success) {
					yield { success: true, column: action.column.name, action: action.action }
				} else {
					yield {
						success: false,
						column: action.column.name,
						error: 'Archive returned false',
						action: action.action,
					}
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error)
				yield { success: false, column: action.column.name, error: msg, action: action.action }
			}
		}
	}
}

const COMPLETED_ACTION_VERBS: Record<PlanAction['action'], string> = {
	create: 'Created',
	update: 'Updated',
	destroy: 'Archived',
	destroy_extra: 'Removed',
}

// ============================================================================
// CLI Helpers
// ============================================================================

function formatDiff(diff: ColumnDiff): string {
	const parts: string[] = []
	if (diff.color) {
		parts.push(`color: ${diff.color.from} → ${diff.color.to}`)
	}
	if (diff.description) {
		const from = diff.description.from ? `"${diff.description.from.slice(0, 20)}..."` : '(none)'
		const to = diff.description.to ? `"${diff.description.to.slice(0, 20)}..."` : '(none)'
		parts.push(`desc: ${from} → ${to}`)
	}
	return parts.join(', ')
}

function printPlan(plan: EnsureColumnsPlan): void {
	const modeLabels = { ensure: 'Ensure', destroy: 'DESTROY', sync: 'Sync' }
	const modeLabel = modeLabels[plan.mode]
	console.log(chalk.bold(`\n${modeLabel} plan for team ${plan.teamName} (${plan.teamKey}):\n`))

	const creates = plan.actions.filter((a) => a.action === 'create')
	const updates = plan.actions.filter((a) => a.action === 'update')
	const destroys = plan.actions.filter((a) => a.action === 'destroy')
	const destroysExtra = plan.actions.filter((a) => a.action === 'destroy_extra')
	const skips = plan.actions.filter((a) => a.action === 'skip')
	const skipsMissing = plan.actions.filter((a) => a.action === 'skip_missing')
	const errors = plan.actions.filter((a) => a.action === 'error')

	for (const action of creates) {
		const type = action.column.type || 'started'
		console.log(chalk.green(`  + ${action.column.name}`) + chalk.dim(` (${action.column.color}, ${type})`))
	}

	for (const action of updates) {
		const diffStr = action.diff ? formatDiff(action.diff) : ''
		console.log(chalk.cyan(`  ~ ${action.column.name}`) + chalk.dim(` (${diffStr})`))
	}

	for (const action of destroys) {
		console.log(chalk.red(`  - ${action.column.name}`) + chalk.dim(' (will be archived)'))
	}

	for (const action of destroysExtra) {
		console.log(chalk.red(`  - ${action.column.name}`) + chalk.dim(` (${action.reason})`))
	}

	for (const action of skips) {
		console.log(chalk.dim(`    ${action.column.name} (${action.reason})`))
	}

	for (const action of skipsMissing) {
		console.log(chalk.dim(`    ${action.column.name} (${action.reason})`))
	}

	for (const action of errors) {
		console.log(chalk.red(`  ! ${action.column.name}`) + chalk.dim(` (${action.reason})`))
	}

	console.log()
	console.log(chalk.bold('Summary:'))
	if (plan.mode === 'ensure' || plan.mode === 'sync') {
		if (creates.length > 0) console.log(`  To create:  ${creates.length}`)
		if (updates.length > 0) console.log(`  To update:  ${updates.length}`)
		if (destroysExtra.length > 0) console.log(`  To remove:  ${destroysExtra.length}`)
		if (skips.length > 0) console.log(`  Unchanged:  ${skips.length}`)
	} else {
		console.log(`  To destroy: ${destroys.length}`)
		console.log(`  To skip:    ${skipsMissing.length}`)
	}
	if (errors.length > 0) {
		console.log(`  Errors:     ${errors.length}`)
	}
}

async function promptApproval(): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		rl.question('\nProceed with these changes? [y/N] ', (answer) => {
			rl.close()
			resolve(answer.toLowerCase() === 'y')
		})
	})
}

// ============================================================================
// Main Command
// ============================================================================

export interface EnsureColumnsOptions {
	force?: boolean
	dryRun?: boolean
	destroy?: boolean
	removeOtherColumns?: boolean
	useRpiDefaults?: boolean
}

export async function ensureColumnsCommand(
	linear: LinearClient | undefined,
	teamKey: string,
	configPath: string | undefined,
	options: EnsureColumnsOptions = {},
): Promise<void> {
	if (!linear) {
		console.error(chalk.red('Error: Linear client not initialized. Check your API key.'))
		process.exit(1)
	}

	const isDestroy = options.destroy === true

	try {
		// Load config
		let config: ColumnsConfig
		if (options.useRpiDefaults) {
			console.log(chalk.dim('Using RPI default columns (18 workflow states)...'))
			config = RPI_DEFAULT_COLUMNS
		} else if (configPath) {
			console.log(chalk.dim(`Loading config from ${configPath}...`))
			config = await loadColumnsConfig(configPath)
		} else {
			console.error(chalk.red('Error: Either provide a config file path or use --use-rpi-defaults'))
			process.exit(1)
		}

		// Plan
		const planMode = isDestroy ? 'destroy' : options.removeOtherColumns ? 'sync' : 'changes'
		console.log(chalk.dim(`Planning ${planMode}...`))
		const plan = isDestroy
			? await planDestroyColumns(linear, teamKey, config)
			: await planEnsureColumns(linear, teamKey, config, { removeOtherColumns: options.removeOtherColumns })

		// Print plan
		printPlan(plan)

		// Check for errors (only in ensure/sync mode)
		if (!isDestroy) {
			const errors = plan.actions.filter((a) => a.action === 'error')
			if (errors.length > 0) {
				console.error(chalk.red('\nCannot proceed due to validation errors.'))
				process.exit(1)
			}
		}

		// Check if anything to do
		const actionableActions = ['create', 'update', 'destroy', 'destroy_extra']
		const actionableCount = plan.actions.filter((a) => actionableActions.includes(a.action)).length

		if (actionableCount === 0) {
			console.log(chalk.green('\nNo changes needed. Everything is up to date.'))
			return
		}

		// Dry run
		if (options.dryRun) {
			console.log(chalk.blue('\nDry run - no changes made.'))
			return
		}

		// Approval
		if (!options.force) {
			const approved = await promptApproval()
			if (!approved) {
				console.log(chalk.yellow('Aborted.'))
				return
			}
		}

		// Execute
		console.log(chalk.bold('\nExecuting...\n'))

		const counts = { created: 0, updated: 0, archived: 0, failed: 0 }

		for await (const result of executeEnsureColumnsPlan(linear, plan)) {
			const verb = COMPLETED_ACTION_VERBS[result.action]

			if (result.success) {
				console.log(chalk.green(`  ✓ ${verb} "${result.column}"`))
				if (result.action === 'create') counts.created++
				else if (result.action === 'update') counts.updated++
				else counts.archived++
			} else {
				console.log(chalk.red(`  ✗ Failed to ${verb.toLowerCase()} "${result.column}": ${result.error}`))
				counts.failed++
			}
		}

		console.log(chalk.bold('\nComplete:'))
		if (counts.created > 0) console.log(`  Created:  ${counts.created}`)
		if (counts.updated > 0) console.log(`  Updated:  ${counts.updated}`)
		if (counts.archived > 0) console.log(`  Archived: ${counts.archived}`)
		if (counts.failed > 0) console.log(`  Failed:   ${counts.failed}`)

		if (counts.failed > 0) {
			process.exit(1)
		}
	} catch (error) {
		console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
