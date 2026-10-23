import { LinearClient } from '@linear/sdk'
import { $ } from 'bun'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'

import { getActiveCollection, loadRpiConfig, migrateConfig } from '../config'
import { hookLog } from '../hookLogger'

const log = (msg: string) => hookLog('autoadvance', msg)

interface PostToolUseInput {
	tool_name?: string
	tool_input?: {
		file_path?: string
		skill?: string
		args?: string
	}
}

const DOCUMENT_TYPES = ['research-questions', 'research', 'design-discussion', 'structure-outline', 'plan'] as const
const DocumentType = Schema.Literals(DOCUMENT_TYPES)
type DocumentType = typeof DocumentType.Type

const DOCUMENT_TO_STATUS: Record<DocumentType, string> = {
	'research-questions': 'questions-in-review',
	research: 'research-in-review',
	'design-discussion': 'design-in-review',
	'structure-outline': 'structure-in-review',
	plan: 'plan-in-review',
}

const RPI_SKILLS = [
	'rpi:create-research-questions',
	'rpi:iterate-research-questions',
	'rpi:create-research',
	'rpi:iterate-research',
	'rpi:create-design-discussion',
	'rpi:iterate-design-discussion',
	'rpi:create-structure-outline',
	'rpi:iterate-structure-outline',
	'rpi:create-plan',
	'rpi:iterate-plan',
	'rpi:implement-plan',
	'rpi:iterate-implementation',
	'rpi:setup-worktree',
] as const
const RpiSkill = Schema.Literals(RPI_SKILLS)
type RpiSkill = typeof RpiSkill.Type

const SKILL_TO_STATUS: Record<RpiSkill, string> = {
	'rpi:create-research-questions': 'questions-in-progress',
	'rpi:iterate-research-questions': 'questions-in-progress',
	'rpi:create-research': 'research-in-progress',
	'rpi:iterate-research': 'research-in-progress',
	'rpi:create-design-discussion': 'design-in-progress',
	'rpi:iterate-design-discussion': 'design-in-progress',
	'rpi:create-structure-outline': 'structure-in-progress',
	'rpi:iterate-structure-outline': 'structure-in-progress',
	'rpi:create-plan': 'plan-in-progress',
	'rpi:iterate-plan': 'plan-in-progress',
	'rpi:implement-plan': 'in-dev',
	'rpi:iterate-implementation': 'in-dev',
	'rpi:setup-worktree': 'in-dev',
}

function extractIssueId(branchName: string): string | null {
	const match = branchName.match(/[A-Za-z0-9]+-\d+/)
	return match ? match[0].toUpperCase() : null
}

function getDocumentType(filePath: string): DocumentType | null {
	const patterns = [
		{ pattern: /-research-questions\.md$/i, type: 'research-questions' },
		{ pattern: /-research\.md$/i, type: 'research' },
		{ pattern: /-design-discussion\.md$/i, type: 'design-discussion' },
		{ pattern: /-structure-outline\.md$/i, type: 'structure-outline' },
		{ pattern: /-plan\.md$/i, type: 'plan' },
	] as const
	for (const { pattern, type } of patterns) {
		if (pattern.test(filePath)) return type
	}
	return null
}

function getStatusFromToolUse(input: PostToolUseInput): string | null {
	const { tool_name, tool_input } = input

	if (tool_name === 'Write' || tool_name === 'Edit' || tool_name === 'MultiEdit') {
		const filePath = tool_input?.file_path
		if (!filePath?.includes('/rpi/tasks/')) return null
		const docType = getDocumentType(filePath)
		if (!docType) return null
		return DOCUMENT_TO_STATUS[docType]
	}

	if (tool_name === 'Skill') {
		const skill = tool_input?.skill
		const parsedSkill = Schema.decodeUnknownOption(RpiSkill)(skill)
		return Option.isSome(parsedSkill) ? SKILL_TO_STATUS[parsedSkill.value] : null
	}

	return null
}

export async function autoadvanceCommand(): Promise<void> {
	// Read JSON from stdin
	let inputJson = ''
	for await (const chunk of process.stdin) {
		inputJson += chunk
	}

	let input: PostToolUseInput
	try {
		input = JSON.parse(inputJson)
	} catch {
		return
	}

	// Check if Linear integration is enabled for this directory
	const config = await loadRpiConfig()
	if (config) {
		const migratedConfig = migrateConfig(config)
		try {
			const collection = getActiveCollection(process.cwd(), migratedConfig)
			if (collection.linearIntegrationEnabled === false) {
				log('Linear integration disabled for this collection, skipping')
				return
			}
		} catch {
			// No collection configured, continue with default behavior
		}
	}

	// Determine target status
	const status = getStatusFromToolUse(input)
	if (!status) {
		return
	}

	// Extract ticket ID from multiple sources (skill args, file path, git branch)
	let ticketId: string | null = null

	// Try skill args first (e.g., "CORE-232" passed to rpi:create-research-questions)
	if (input.tool_input?.args) {
		ticketId = extractIssueId(input.tool_input.args)
	}

	// Try file path (e.g., rpi/tasks/CORE-232-description/...)
	if (!ticketId && input.tool_input?.file_path) {
		ticketId = extractIssueId(input.tool_input.file_path)
	}

	// Fallback to git branch
	if (!ticketId) {
		try {
			const result = await $`git branch --show-current`.quiet().nothrow()
			if (result.exitCode === 0) {
				const branchName = result.stdout.toString().trim()
				ticketId = extractIssueId(branchName)
			}
		} catch {
			// Ignore git errors
		}
	}

	if (!ticketId) {
		return
	}

	// Update Linear status
	const apiKey = process.env.LINEAR_API_KEY
	if (!apiKey) {
		log('LINEAR_API_KEY not set')
		return
	}

	try {
		const linear = new LinearClient({ apiKey })
		const issue = await linear.issue(ticketId)
		const team = await issue.team
		if (!team) {
			log(`Could not find team for ${ticketId}`)
			return
		}
		const states = await team.states()
		const targetState = states.nodes.find(
			(state: { name: string; id: string }) => state.name.toLowerCase() === status.toLowerCase(),
		)
		if (!targetState) {
			log(`Status "${status}" not found for team`)
			return
		}
		await linear.issueUpdate(issue.id, { stateId: targetState.id })
		log(`Updated ${ticketId} to "${status}"`)
	} catch (err) {
		const message = Predicate.isError(err) ? err.message : 'Unknown error'
		log(`Failed to update Linear: ${message}`)
	}
}
