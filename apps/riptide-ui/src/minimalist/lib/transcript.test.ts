import { describe, expect, it } from 'vitest'

import { summarizeStep } from '@/minimalist/lib/tools'
import {
	buildTurns,
	type EventRow,
	groupSteps,
	readDenial,
	skillPromptName,
	type ToolStep,
} from '@/minimalist/lib/transcript'

let clock = 1_000
function row(partial: Partial<EventRow>): EventRow {
	clock += 1_000
	return {
		id: `e${clock}`,
		event_type: 'message',
		role: 'assistant',
		content: null,
		tool_call_id: null,
		tool_name: null,
		tool_input_json: null,
		parent_tool_use_id: null,
		tool_result_for_id: null,
		tool_result_content: null,
		approval_status: null,
		approval_id: null,
		user_name: null,
		created_at: clock,
		...partial,
	}
}

describe('buildTurns', () => {
	it('keeps who sent each message so multiplayer threads can show their avatar', () => {
		const turns = buildTurns([row({ role: 'user', content: 'Ship it', user_id: 'user_ada', user_name: 'Ada' })])
		expect(turns[0]).toMatchObject({ kind: 'user', userId: 'user_ada', author: 'Ada' })
	})

	it('folds agent work into one turn and lifts the trailing message out as the answer', () => {
		const rows = [
			row({ role: 'user', content: 'Add rate limiting' }),
			row({ content: "I'll look at the route first." }),
			row({
				event_type: 'tool_call',
				tool_call_id: 't1',
				tool_name: 'Read',
				tool_input_json: { file_path: '/r/ingest.ts' },
			}),
			row({ event_type: 'tool_result', tool_result_for_id: 't1', tool_result_content: 'export const ingest' }),
			row({
				event_type: 'tool_call',
				tool_call_id: 't2',
				tool_name: 'Bash',
				tool_input_json: { command: 'bun test' },
			}),
			row({ event_type: 'tool_result', tool_result_for_id: 't2', tool_result_content: 'ok' }),
			row({ content: 'Done. Requests over 60 a minute now get a 429.' }),
		]
		const turns = buildTurns(rows)
		expect(turns.map((turn) => turn.kind)).toEqual(['user', 'agent'])
		const agent = turns[1]
		if (agent?.kind !== 'agent') throw new Error('expected an agent turn')
		expect(agent.answer).toBe('Done. Requests over 60 a minute now get a 429.')
		expect(agent.steps.map((step) => step.kind)).toEqual(['commentary', 'tool', 'tool'])
		const bash = agent.steps[2] as ToolStep
		expect(bash.result).toBe('ok')
		expect(summarizeStep(bash)).toMatchObject({ verb: 'Ran', target: 'bun test' })
	})

	it('nests subagent events under their Task call and keeps them out of the root', () => {
		const rows = [
			row({ role: 'user', content: 'Find helpers' }),
			row({
				event_type: 'tool_call',
				tool_call_id: 'task',
				tool_name: 'Task',
				tool_input_json: { subagent_type: 'codebase-locator' },
			}),
			row({
				event_type: 'tool_call',
				tool_call_id: 'c1',
				tool_name: 'Grep',
				parent_tool_use_id: 'task',
				tool_input_json: { pattern: 'limit' },
			}),
			row({ event_type: 'tool_result', tool_result_for_id: 'c1', tool_result_content: 'a.ts\nb.ts' }),
			row({ event_type: 'tool_result', tool_result_for_id: 'task', tool_result_content: 'Found 2' }),
		]
		const agent = buildTurns(rows)[1]
		if (agent?.kind !== 'agent') throw new Error('expected an agent turn')
		expect(agent.steps).toHaveLength(1)
		const task = agent.steps[0] as ToolStep
		expect(task.children).toHaveLength(1)
		expect(summarizeStep(task.children[0] as ToolStep)).toMatchObject({ target: 'limit', meta: '2 results' })
	})

	it('marks compaction and keeps a running turn open without an answer', () => {
		const rows = [
			row({ event_type: 'system', role: 'system', content: JSON.stringify({ kind: 'context_compaction' }) }),
			row({ role: 'user', content: 'Run tests' }),
			row({
				event_type: 'tool_call',
				tool_call_id: 'b',
				tool_name: 'Bash',
				tool_input_json: { command: 'bun test' },
			}),
		]
		const turns = buildTurns(rows)
		expect(turns.map((turn) => turn.kind)).toEqual(['compaction', 'user', 'agent'])
		const agent = turns[2]
		if (agent?.kind !== 'agent') throw new Error('expected an agent turn')
		expect(agent.answer).toBeNull()
		expect(summarizeStep(agent.steps[0] as ToolStep).verb).toBe('Running')
	})
})

describe('denied calls', () => {
	const denied = (result: string) => {
		const [, turn] = buildTurns([
			row({ role: 'user', content: 'Write the date' }),
			row({
				event_type: 'tool_call',
				tool_call_id: 'd1',
				tool_name: 'Bash',
				tool_input_json: { command: 'date > f' },
			}),
			row({ event_type: 'tool_result', tool_result_for_id: 'd1', tool_result_content: result }),
		])
		const step = turn?.kind === 'agent' ? turn.steps[0] : undefined
		if (step?.kind !== 'tool') throw new Error('expected a tool step')
		return step
	}

	it('reads a denial from the result, since the call row is not marked', () => {
		const step = denied('The user denied this tool call with feedback: Skip it')
		expect(step.approvalStatus).toBe('denied')
		expect(summarizeStep(step).verb).toBe('Wanted to run')
		expect(readDenial(step.result)).toEqual({ feedback: 'Skip it' })
		expect(readDenial('Request denied by user')).toEqual({ feedback: null })
	})

	it('leaves ordinary results alone', () => {
		expect(denied('Sun Sep 28').approvalStatus).toBeNull()
		expect(readDenial('Sun Sep 28')).toBeNull()
	})
})

describe('groupSteps', () => {
	it('groups consecutive reads and searches but leaves a lone read alone', () => {
		const rows = [
			row({ role: 'user', content: 'go' }),
			row({ event_type: 'tool_call', tool_call_id: 'r1', tool_name: 'Read', tool_input_json: {} }),
			row({ event_type: 'tool_call', tool_call_id: 'g1', tool_name: 'Grep', tool_input_json: {} }),
			row({ event_type: 'tool_call', tool_call_id: 'b1', tool_name: 'Bash', tool_input_json: {} }),
			row({ event_type: 'tool_call', tool_call_id: 'r2', tool_name: 'Read', tool_input_json: {} }),
		]
		const agent = buildTurns(rows)[1]
		if (agent?.kind !== 'agent') throw new Error('expected an agent turn')
		expect(groupSteps(agent.steps).map((group) => group.kind)).toEqual(['explore', 'single', 'single'])
	})
})

describe('skill prompts', () => {
	const prompt = 'Base directory for this skill: /Users/me/.claude/skills/rpi/create-plan\n\n# Create a plan'

	it('names the skill from either prompt shape', () => {
		expect(skillPromptName(prompt)).toBe('create-plan')
		expect(skillPromptName('<skill name="rpi:create-plan">\nSteps')).toBe('rpi:create-plan')
		expect(skillPromptName('Just a message')).toBeNull()
	})

	it("makes a Skill call's result the instructions it loaded, not a message from you", () => {
		const turns = buildTurns([
			row({ role: 'user', content: 'Plan the rate limiter' }),
			row({
				event_type: 'tool_call',
				tool_call_id: 's1',
				tool_name: 'Skill',
				tool_input_json: { skill: 'rpi:create-plan' },
			}),
			row({
				event_type: 'tool_result',
				tool_result_for_id: 's1',
				tool_result_content: 'Launching skill: rpi:create-plan',
			}),
			row({ role: 'user', content: prompt }),
			row({ content: 'Here is the plan.' }),
		])
		expect(turns.map((turn) => turn.kind)).toEqual(['user', 'agent'])
		const agent = turns[1]
		if (agent?.kind !== 'agent') throw new Error('expected an agent turn')
		expect(agent.steps).toHaveLength(1)
		expect((agent.steps[0] as ToolStep).result).toBe(prompt)
		expect(agent.answer).toBe('Here is the plan.')
	})

	it("shows a skill loaded by a typed command as one step of the agent's work", () => {
		const turns = buildTurns([
			row({ role: 'user', content: '/rpi:create-plan the rate limiter' }),
			row({ role: 'user', content: prompt }),
			row({ content: 'Here is the plan.' }),
		])
		expect(turns.map((turn) => turn.kind)).toEqual(['user', 'agent'])
		const agent = turns[1]
		if (agent?.kind !== 'agent') throw new Error('expected an agent turn')
		expect(agent.steps).toEqual([{ kind: 'skill', id: expect.any(String), name: 'create-plan', text: prompt }])
	})
})
