import { describe, expect, it } from 'vitest'

import { parseNextStep } from './next-step'

const suggestion = (nextStepPrompt: string, nextStepType = 'create-tdd') => [
	{
		parsedAt: 0,
		extraction: {
			type: 'next_step_found',
			nextStepPrompt,
			nextStepSummary: 'Write the technical design',
			nextStepType,
			taskReference: 'task',
		},
	},
]

describe('parseNextStep', () => {
	it('names the skill, its command and the phase label the next session gets', () => {
		const step = parseNextStep(suggestion('use the rpi:create-tdd skill for .humanlayer/tasks/app'))
		expect(step).toMatchObject({
			action: 'Write the technical design',
			command: '/rpi:create-tdd',
			targetLabel: 'rpi:design-tdd',
		})
	})

	// A typed slash command is expanded by the agent without a Skill call, and the Skill call is
	// what labels the session with its phase. So the first message asks for the skill in words.
	it('starts the next session with a skill instruction, not a slash command', () => {
		expect(parseNextStep(suggestion('use the rpi:create-tdd skill for .humanlayer/tasks/app'))?.prompt).toBe(
			'use the rpi:create-tdd skill for .humanlayer/tasks/app',
		)
		expect(parseNextStep(suggestion('/rpi:create-tdd .humanlayer/tasks/app/04-prd.md'))?.prompt).toBe(
			'use the rpi:create-tdd skill .humanlayer/tasks/app/04-prd.md',
		)
		expect(parseNextStep(suggestion('/rpi:create-tdd'))?.prompt).toBe('use the rpi:create-tdd skill')
		expect(parseNextStep(suggestion('write the TDD from the PRD'))?.prompt).toBe(
			'use the rpi:create-tdd skill write the TDD from the PRD',
		)
	})

	it('works the same for every RPI step, such as the outline after the TDD', () => {
		const step = parseNextStep(suggestion('/rpi:create-structure-outline for app', 'create-structure-outline'))
		expect(step?.prompt).toBe('use the rpi:create-structure-outline skill for app')
		expect(step?.targetLabel).toBe('rpi:structure')
	})

	it('leaves a prompt alone when the step is not an RPI skill or names another command', () => {
		expect(parseNextStep(suggestion('Fix the failing test', 'other'))?.prompt).toBe('Fix the failing test')
		expect(parseNextStep(suggestion('/hl:show-me the change'))?.prompt).toBe('/hl:show-me the change')
	})

	it('reads the column as JSON text too, and gives nothing without a suggestion', () => {
		expect(parseNextStep(JSON.stringify(suggestion('/rpi:create-tdd')))?.prompt).toBe(
			'use the rpi:create-tdd skill',
		)
		expect(parseNextStep(null)).toBeNull()
		expect(parseNextStep('not json')).toBeNull()
	})
})
