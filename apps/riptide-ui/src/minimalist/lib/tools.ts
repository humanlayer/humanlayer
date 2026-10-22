import { artifactPath } from '@/minimalist/lib/artifacts'
import { basename, plural, text } from '@/minimalist/lib/format'
import { normalizeToolName, type Step, type ToolStep } from '@/minimalist/lib/transcript'

export type StepIcon = 'file' | 'terminal' | 'search' | 'bot' | 'globe' | 'todo' | 'plug' | 'list' | 'message' | 'tool'

type StepSummary = {
	icon: StepIcon
	/** Past-tense verb when done, present when running: "Ran" / "Running". */
	verb: string
	/** The code-ish target shown in mono, e.g. a command or file name. */
	target: string | null
	/** Trailing muted fact, e.g. "+22 −4" or "14 results". */
	meta: string | null
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null
}

function lines(text: string | null): string[] {
	return text ? text.replace(/\n$/, '').split('\n') : []
}

/** Lines added and removed by replacing `before` with `after`, not counting unchanged lines at either end. */
function changedLines(before: string | null, after: string | null): { added: number; removed: number } {
	const old = lines(before)
	const next = lines(after)
	let start = 0
	while (start < old.length && start < next.length && old[start] === next[start]) start += 1
	let end = 0
	while (
		end < old.length - start &&
		end < next.length - start &&
		old[old.length - 1 - end] === next[next.length - 1 - end]
	)
		end += 1
	return { added: next.length - start - end, removed: old.length - start - end }
}

export function editCounts(step: ToolStep): { added: number; removed: number } {
	const input = step.input
	const name = normalizeToolName(step.name)
	if (name === 'write') return { added: lines(str(input.content)).length, removed: 0 }
	if (name === 'multiedit' && Array.isArray(input.edits)) {
		return (input.edits as Array<Record<string, unknown>>).reduce<{ added: number; removed: number }>(
			(acc, edit) => {
				const counts = changedLines(str(edit.old_string), str(edit.new_string))
				return { added: acc.added + counts.added, removed: acc.removed + counts.removed }
			},
			{ added: 0, removed: 0 },
		)
	}
	return changedLines(str(input.old_string), str(input.new_string))
}

export function isEditTool(name: string): boolean {
	return ['edit', 'multiedit', 'write', 'applypatch', 'notebookedit'].includes(normalizeToolName(name))
}

/** What a pending approval asks for, in a few words: "Wants to run" and the command's first line. */
export function askSummary(
	toolName: string | null,
	input: Record<string, unknown>,
): { text: string; code: string | null } {
	const name = normalizeToolName(toolName ?? '')
	if (name === 'askuserquestion') return { text: 'Asked a question', code: null }
	if (name === 'exitplanmode') return { text: 'Plan ready for review', code: null }
	if (name === 'bash') {
		const command = str(input.command)?.trim().split('\n')[0]
		return command ? { text: 'Wants to run', code: command } : { text: 'Wants to run a command', code: null }
	}
	if (isEditTool(name)) {
		const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path)
		return path ? { text: 'Wants to edit', code: basename(path) } : { text: 'Wants to edit a file', code: null }
	}
	return toolName ? { text: 'Wants to use', code: toolName } : { text: 'Needs approval', code: null }
}

// Redirects into a file, in-place edits, and commands that move files around. A guess, but a
// cheap one: it only decides whether the review panel opens by itself.
const SHELL_WRITE =
	/(^|[^0-9&<>])>>?\s*[^&\s]|\bsed\s+(-[a-zA-Z]*i|--in-place)|\btee\b|\bgit\s+(apply|mv|rm|restore|checkout\s+--)|(^|[;&|]\s*)(mv|cp|rm|touch|mkdir)\s/

/** Whether a tool call probably changed files in the working copy. */
export function changesFiles(name: string, input: Record<string, unknown>): boolean {
	if (isEditTool(name)) return true
	const command = normalizeToolName(name) === 'bash' ? str(input.command) : null
	return command !== null && SHELL_WRITE.test(command.replace(/2>&1|>\s*\/dev\/null/g, ''))
}

export function summarizeStep(step: ToolStep): StepSummary {
	const input = step.input
	const done = step.endedAt !== null
	const name = normalizeToolName(step.name)
	const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path)
	switch (name) {
		case 'bash': {
			const command = str(input.command)?.split('\n')[0] ?? null
			return {
				icon: 'terminal',
				verb: approvalVerb(step, ['Wants to run', 'Wanted to run', 'Ran', 'Running']),
				target: command,
				meta: null,
			}
		}
		case 'bashoutput':
			return { icon: 'terminal', verb: 'Read output of', target: 'a background command', meta: null }
		case 'read':
			return { icon: 'file', verb: done ? 'Read' : 'Reading', target: path ? basename(path) : null, meta: null }
		case 'edit':
		case 'multiedit':
		case 'write':
		case 'applypatch':
		case 'notebookedit': {
			const { added, removed } = editCounts(step)
			const verb =
				name === 'write'
					? approvalVerb(step, ['Wants to write', 'Wanted to write', 'Wrote', 'Writing'])
					: approvalVerb(step, ['Wants to edit', 'Wanted to edit', 'Edited', 'Editing'])
			return { icon: 'file', verb, target: path ? basename(path) : null, meta: `+${added} −${removed}` }
		}
		case 'grep': {
			const count = step.result ? step.result.split('\n').filter(Boolean).length : null
			return {
				icon: 'search',
				verb: done ? 'Searched for' : 'Searching for',
				target: str(input.pattern),
				meta: count === null ? null : plural(count, 'result'),
			}
		}
		case 'glob':
			return { icon: 'search', verb: done ? 'Listed' : 'Listing', target: str(input.pattern), meta: null }
		case 'ls':
			return {
				icon: 'search',
				verb: done ? 'Listed' : 'Listing',
				target: path ? basename(path) : null,
				meta: null,
			}
		case 'task':
		case 'agent': {
			const type = str(input.subagent_type) ?? 'subagent'
			return {
				icon: 'bot',
				verb: type,
				target: null,
				meta: [
					str(input.description),
					plural(step.children.filter((c) => c.kind === 'tool').length, 'tool call'),
				]
					.filter(Boolean)
					.join(' · '),
			}
		}
		case 'todowrite':
			return { icon: 'todo', verb: 'Updated the plan', target: null, meta: null }
		case 'webfetch':
			return { icon: 'globe', verb: done ? 'Fetched' : 'Fetching', target: hostOf(str(input.url)), meta: null }
		case 'websearch':
			return {
				icon: 'globe',
				verb: done ? 'Searched the web for' : 'Searching the web for',
				target: str(input.query),
				meta: null,
			}
		case 'skill':
			return { icon: 'list', verb: 'Used skill', target: str(input.skill) ?? str(input.command), meta: null }
		case 'askuserquestion':
			return { icon: 'message', verb: 'Asked you', target: null, meta: null }
		case 'exitplanmode':
			return { icon: 'list', verb: 'Proposed a plan', target: null, meta: null }
		default:
			if (step.name.startsWith('mcp__')) {
				const [, server, tool] = step.name.split('__')
				return { icon: 'plug', verb: 'Called', target: `${server}.${tool}`, meta: null }
			}
			return { icon: 'tool', verb: 'Used', target: step.name, meta: null }
	}
}

/** A call that needs approval: waiting on you, denied (so it never ran), done, or running. */
function approvalVerb(step: ToolStep, [pending, denied, past, present]: [string, string, string, string]): string {
	if (step.approvalStatus === 'pending') return pending
	if (step.approvalStatus === 'denied') return denied
	return step.endedAt !== null ? past : present
}

function hostOf(url: string | null): string | null {
	if (!url) return null
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

export type FileEdits = { path: string; added: number; removed: number }

/**
 * What a turn wrote: the task documents, which get cards of their own, and each
 * repository file with the lines added and removed. Edits that failed or were
 * denied changed nothing, so they don't count.
 */
export function turnWrites(steps: readonly Step[]): { docs: string[]; files: FileEdits[] } {
	const docs = new Set<string>()
	const files = new Map<string, FileEdits>()
	for (const step of steps) {
		if (step.kind !== 'tool' || !isEditTool(step.name) || step.isError) continue
		const path = text(step.input.file_path, step.input.path)
		const doc = artifactPath(path)?.fileName
		if (doc) {
			docs.add(doc)
			continue
		}
		const counts = editCounts(step)
		const current = files.get(path) ?? { path, added: 0, removed: 0 }
		files.set(path, { path, added: current.added + counts.added, removed: current.removed + counts.removed })
	}
	return { docs: [...docs], files: [...files.values()] }
}

export type TodoItem = { content: string; status: 'pending' | 'in_progress' | 'completed' }

/** The agent's plan as its last todo update left it. */
export function latestTodos(steps: readonly Step[]): TodoItem[] {
	for (let index = steps.length - 1; index >= 0; index -= 1) {
		const step = steps[index]
		if (step?.kind === 'tool' && normalizeToolName(step.name) === 'todowrite') return readTodos(step)
	}
	return []
}

function readTodos(step: ToolStep): TodoItem[] {
	const todos = step.input.todos
	if (!Array.isArray(todos)) return []
	return todos
		.map((todo: unknown) => {
			const record = todo as Record<string, unknown>
			const content = str(record.content) ?? str(record.activeForm)
			const status = record.status === 'completed' || record.status === 'in_progress' ? record.status : 'pending'
			return content ? { content, status } : null
		})
		.filter((todo): todo is TodoItem => todo !== null)
}
