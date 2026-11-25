import { MockLanguageModelV3 } from 'ai/test'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { extractNextStep } from './extract-next-step'
import {
	extractNextStepEffectWithService,
	NextStepExtractionError,
	NextStepExtractor,
} from './extract-next-step.effect'

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 1, text: 1, reasoning: undefined },
}

const modelSuggestingDirectory = (suggestedDirectory: string) =>
	new MockLanguageModelV3({
		doGenerate: {
			content: [
				{
					type: 'text',
					text: JSON.stringify({
						found: true,
						nextStepPrompt: 'use the rpi:implement-outline skill for task .humanlayer/tasks/eng-1234',
						nextStepSummary: 'implement: eng-1234',
						nextStepType: 'rpi:implement-outline',
						taskReference: 'eng-1234',
						suggestedDirectory,
					}),
				},
			],
			finishReason: { unified: 'stop', raw: undefined },
			usage,
			warnings: [],
		},
	})

const suggestedDirectoryFor = async (message: string, modelValue: string) => {
	const result = await extractNextStep(message, { model: modelSuggestingDirectory(modelValue) })
	expect(result.extractionError).toBeUndefined()
	if (result.extraction.type !== 'next_step_found') throw new Error('expected next_step_found')
	return result.extraction.suggestedDirectory
}

const handoffIn = (
	directory: string,
) => `Worktree for eng-1234 has been configured. You can start implementation by running

\`\`\`text
use the rpi:implement-outline skill for task .humanlayer/tasks/eng-1234
\`\`\`

in the ${directory} directory`

describe('extractNextStep suggestedDirectory', () => {
	it('drops model reasoning when the message names no directory (#1129)', async () => {
		const message = `Research is complete. Set up a worktree for this task in a new session:

\`\`\`text
use the rpi:setup-worktree skill for .humanlayer/tasks/eng-1234
\`\`\`
`
		const reasoning =
			"none specified in message about running location, not in directory instructions, only general guidance to set up or create new session - no explicit directory path provided for where to run from/in - this is not a directory suggestion but rather general task flow guidance that doesn't specify a directory like 'in ~/wt/projectname'"

		expect(await suggestedDirectoryFor(message, reasoning)).toBeUndefined()
	})

	it.each([
		['a home-relative worktree', '~/wt/humanlayer/eng-1234'],
		['an absolute worktree', '/Users/me/.humanlayer/workspaces/eng-1234/humanlayer'],
		['an absolute path with spaces', '/Users/me/My Projects/humanlayer'],
		['a Windows drive path', 'C:\\Users\\me\\wt\\eng-1234'],
		['a Windows drive path with forward slashes', 'C:/Users/me/wt/eng-1234'],
		['a UNC path', '\\\\server\\share\\wt\\eng-1234'],
		['the home directory', '~'],
	])('keeps %s that the message names', async (_case, directory) => {
		expect(await suggestedDirectoryFor(handoffIn(directory), directory)).toBe(directory)
	})

	it('keeps a directory when the model adds a trailing slash', async () => {
		expect(await suggestedDirectoryFor(handoffIn('~/wt/humanlayer/eng-1234'), '~/wt/humanlayer/eng-1234/')).toBe(
			'~/wt/humanlayer/eng-1234/',
		)
	})

	it('keeps a Windows directory when the model adds a trailing backslash', async () => {
		expect(await suggestedDirectoryFor(handoffIn('C:\\Users\\me\\wt'), 'C:\\Users\\me\\wt\\')).toBe(
			'C:\\Users\\me\\wt\\',
		)
	})

	it.each([
		['in backticks', 'Run it in `~/wt/humanlayer/eng-1234`.', '~/wt/humanlayer/eng-1234'],
		['in quotes', 'Run it in "/Users/me/My Projects/humanlayer".', '/Users/me/My Projects/humanlayer'],
		['at the end of a sentence', 'Run it in ~/wt/humanlayer/eng-1234.', '~/wt/humanlayer/eng-1234'],
		[
			'as a markdown link target',
			'See [the plan](file:///Users/me/wt/eng-1234/plan.md). Run it in [the worktree](/Users/me/wt/eng-1234).',
			'/Users/me/wt/eng-1234',
		],
		['at the start of the message', '~/wt/humanlayer/eng-1234 is ready.', '~/wt/humanlayer/eng-1234'],
		['at the end of the message', 'Run it in ~/wt/humanlayer/eng-1234', '~/wt/humanlayer/eng-1234'],
		[
			'after a file inside it',
			'Saved ~/wt/humanlayer/eng-1234/thoughts/plan.md. Run it in ~/wt/humanlayer/eng-1234.',
			'~/wt/humanlayer/eng-1234',
		],
		[
			'with a trailing slash the model drops',
			'Run it in ~/wt/humanlayer/eng-1234/ now.',
			'~/wt/humanlayer/eng-1234',
		],
	])('keeps a directory the message writes %s', async (_case, message, directory) => {
		expect(await suggestedDirectoryFor(message, directory)).toBe(directory)
	})

	it('trims whitespace around the directory', async () => {
		expect(await suggestedDirectoryFor(handoffIn('~/wt/humanlayer/eng-1234'), ' ~/wt/humanlayer/eng-1234\n')).toBe(
			'~/wt/humanlayer/eng-1234',
		)
	})

	it.each([
		['an empty value', handoffIn('~/wt/humanlayer/eng-1234'), ''],
		['a relative task path', handoffIn('thoughts/tasks/core-180/'), 'thoughts/tasks/core-180/'],
		['a ~user path', handoffIn('~me/wt/eng-1234'), '~me/wt/eng-1234'],
		['a ~\\ path', handoffIn('~\\wt\\eng-1234'), '~\\wt\\eng-1234'],
		['a drive-relative path', handoffIn('C:wt\\eng-1234'), 'C:wt\\eng-1234'],
		['a prompt example the message does not name', handoffIn('new worktree'), '~/wt/project-name'],
		['a fragment of a relative task path', handoffIn('new worktree'), '/tasks/eng-1234'],
		['a parent of the named directory', handoffIn('~/wt/humanlayer/eng-1234'), '~/wt'],
		['a fragment after a non-ASCII name', handoffIn('/Users/josé/wt/eng-1234'), '/wt/eng-1234'],
		['the tail of a home path', handoffIn('~/wt/humanlayer/eng-1234'), '/wt/humanlayer/eng-1234'],
		['the tail of a relative path', handoffIn('./wt/eng-1234'), '/wt/eng-1234'],
		[
			'the home directory taken from the default worktree path',
			handoffIn('~/.humanlayer/workspaces/eng-1234/humanlayer'),
			'~',
		],
		['a prefix that ends before a dot in a name', handoffIn('~/wt/humanlayer.v2/eng-1234'), '~/wt/humanlayer'],
		['a prefix that ends at a dash', handoffIn('~/wt/humanlayer/eng-1234-fix'), '~/wt/humanlayer/eng-1234'],
		['the root taken from a slash in the text', 'Research / plan is next. Run it in the new worktree.', '/'],
		['the root taken from a backslash in the text', 'Research \\ plan is next. Run it in the new worktree.', '\\'],
		['the tail of a drive path', handoffIn('C:/wt/eng-1234'), '/wt/eng-1234'],
		['a UNC path without its first backslash', handoffIn('\\\\server\\share\\wt'), '\\server\\share\\wt'],
		['a value longer than 4096 characters', handoffIn(`/${'a'.repeat(4096)}`), `/${'a'.repeat(4096)}`],
		[
			'a path followed by reasoning',
			handoffIn('~/wt/humanlayer/eng-1234'),
			'~/wt/humanlayer/eng-1234 (from the message)',
		],
		[
			'a value over several lines',
			`${handoffIn('~/wt/humanlayer/eng-1234')}\nthen run it`,
			'~/wt/humanlayer/eng-1234 directory\nthen run it',
		],
	])('drops %s', async (_case, message, modelValue) => {
		expect(await suggestedDirectoryFor(message, modelValue)).toBeUndefined()
	})
})

describe('extractNextStepEffect', () => {
	it('returns mocked extraction results', async () => {
		const extraction = {
			parsedAt: 123,
			extraction: {
				type: 'next_step_found' as const,
				nextStepPrompt: 'use the rpi:create-research skill for .humanlayer/tasks/test',
				nextStepSummary: 'research: test',
				nextStepType: 'create-research' as const,
				taskReference: 'test',
			},
		}

		const result = await Effect.runPromise(
			extractNextStepEffectWithService('assistant message').pipe(
				Effect.provide(Layer.succeed(NextStepExtractor, { extract: async () => extraction })),
			),
		)

		expect(result).toEqual(extraction)
	})

	it('converts extractionError results into tagged failures', async () => {
		const result = await Effect.runPromise(
			extractNextStepEffectWithService('assistant message').pipe(
				Effect.provide(
					Layer.succeed(NextStepExtractor, {
						extract: async () => ({
							parsedAt: 123,
							extraction: { type: 'no_next_step' as const, reason: 'Extraction failed' },
							extractionError: 'model unavailable',
						}),
					}),
				),
				Effect.flip,
			),
		)

		expect(result).toBeInstanceOf(NextStepExtractionError)
		if (result instanceof NextStepExtractionError) {
			expect(result.message).toBe('model unavailable')
		}
	})
})
