import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_MODELS } from '@humanlayer/codelayer'
import { describe, expect, test } from 'vitest'

import {
	buildAutomationPrepareInput,
	loadAutomationPrompt,
	parseAutomationInactivityMs,
	writeAutomationMetadata,
} from '../src/commands/automation-run'
import { parseAutomationRunOptions, type AutomationRunCliOptions } from '../src/commands/AutomationRun'

const validOptions: AutomationRunCliOptions = {
	pat: 'pat-secret',
	ensureTask: 'effect-migration',
	taskName: 'Effect migrations',
	sessionName: 'Effect migration',
	prompt: 'Migrate one procedure',
	codingAgent: 'codelayer',
	provider: 'anthropic',
	shutdownOn: 'inactivity',
	inactivity: '2m',
	onFailure: 'inactivity',
}

describe('automation run options', () => {
	test.each([
		{ ...validOptions, ensureTask: undefined },
		{ ...validOptions, useTask: 'task-1' },
		{ ...validOptions, taskName: undefined },
		{ ...validOptions, promptFile: 'prompt.md' },
		{ ...validOptions, prompt: undefined },
	])('rejects invalid selector and prompt combinations', (options) => {
		expect(() => parseAutomationRunOptions(options)).toThrow()
	})

	test('builds the direct-checkout ensure request', () => {
		const options = parseAutomationRunOptions({
			...validOptions,
			provider: 'codex',
			model: 'gpt-5.6-sol',
			thinking: 'high',
		})
		expect(
			buildAutomationPrepareInput(options, {
				hostId: 'host-id',
				prompt: 'Prompt from checkout',
				workingDirectory: '/checkout/repository',
			}),
		).toEqual({
			taskMode: 'ensure',
			slug: 'effect-migration',
			task: { name: 'Effect migrations', workflowType: 'freeform', worktreeTiming: 'never' },
			hostId: 'host-id',
			sessionName: 'Effect migration',
			prompt: 'Prompt from checkout',
			workingDirectory: '/checkout/repository',
			codingAgent: 'codelayer',
			provider: 'codex',
			model: 'gpt-5.6-sol',
			effort: 'high',
			permissionsMode: 'bypass',
		})
	})

	test('builds a use request without task creation configuration', () => {
		const options = parseAutomationRunOptions({
			...validOptions,
			ensureTask: undefined,
			taskName: undefined,
			useTask: 'existing-task',
			provider: 'copilot',
		})
		const input = buildAutomationPrepareInput(options, {
			hostId: 'host-id',
			prompt: 'Continue',
			workingDirectory: '/checkout/repository',
		})
		expect(input).toEqual(
			expect.objectContaining({
				taskMode: 'use',
				taskIdOrSlug: 'existing-task',
				model: DEFAULT_MODELS.copilot,
			}),
		)
		expect(input).not.toHaveProperty('task')
	})

	test('loads a relative prompt file from the checkout', async () => {
		const checkout = await mkdtemp(join(tmpdir(), 'humanlayer-automation-'))
		try {
			await writeFile(join(checkout, 'prompt.md'), 'Prompt loaded from checkout')
			const options = parseAutomationRunOptions({
				...validOptions,
				prompt: undefined,
				promptFile: 'prompt.md',
			})
			await expect(loadAutomationPrompt(options, checkout)).resolves.toBe('Prompt loaded from checkout')
		} finally {
			await rm(checkout, { recursive: true, force: true })
		}
	})

	test('accepts a metadata output path', () => {
		const options = parseAutomationRunOptions({ ...validOptions, metadataFile: '/tmp/humanlayer-run.json' })
		expect(options.metadataFile).toBe('/tmp/humanlayer-run.json')
	})

	test('writes prepared task and session IDs to a relative metadata file', async () => {
		const checkout = await mkdtemp(join(tmpdir(), 'humanlayer-automation-'))
		try {
			await writeAutomationMetadata('run.json', checkout, {
				taskId: '11111111-1111-4111-8111-111111111111',
				sessionId: '22222222-2222-4222-8222-222222222222',
			})
			expect(JSON.parse(await readFile(join(checkout, 'run.json'), 'utf8'))).toEqual({
				taskId: '11111111-1111-4111-8111-111111111111',
				sessionId: '22222222-2222-4222-8222-222222222222',
			})
		} finally {
			await rm(checkout, { recursive: true, force: true })
		}
	})
})

describe('parseAutomationInactivityMs', () => {
	test('parses bounded duration units', () => {
		expect(parseAutomationInactivityMs('250ms')).toBe(250)
		expect(parseAutomationInactivityMs('30s')).toBe(30_000)
		expect(parseAutomationInactivityMs('2m')).toBe(120_000)
		expect(parseAutomationInactivityMs('1h')).toBe(3_600_000)
	})
})
