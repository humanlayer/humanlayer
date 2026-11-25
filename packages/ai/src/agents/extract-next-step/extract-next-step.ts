import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { NextStepAiOutput, NextStepSuggestion } from '@humanlayer/db/zodschemas/next-step'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import { resolveModel } from '../../providers'

const EXTRACTION_PROMPT = `You are extracting a "next step" prompt from a coding assistant's message.

Look for a code block that contains a prompt suggesting the user run a skill. The code block should reference a skill name like "create-research", "implement-plan", "setup-worktree", "describe-pr", etc.

If found, set found=true and extract:
- nextStepPrompt: The EXACT full text inside the code block (preserve whitespace and newlines exactly)
- nextStepSummary: A short button label in format "skill: task-ref" (e.g., "plan: ll-31-feature", "research: eng-1234"). Use the skill type without "create-" or "iterate-" prefix, and truncate the task reference if needed.
- nextStepType: The skill name referenced in the prompt
- taskReference: The task/ticket identifier if mentioned (e.g., "ll-31-feature-name", "eng-1234-description", "task 12345")
- suggestedDirectory: ONLY extract this if the message explicitly tells the user to run the prompt IN or FROM a specific directory. Look for patterns like:
  * "in ~/wt/project-name" or "in /path/to/dir"
  * "from ~/wt/project-name" or "from /path/to/dir"
  * "start a new session in DIRECTORY"
  * "run PROMPT from DIRECTORY"

  DO NOT extract a directory from:
  * Task paths like "thoughts/tasks/..." or "rpi/tasks/..." - these are task references, NOT directories to run commands in
  * File paths ending in .md, .ts, .json, etc.
  * The skill prompt itself (the code block content) - the "for thoughts/tasks/xxx" part is the task reference
  * References to where files were saved or fetched

If NOT found (no code block with a skill prompt, or just an open-ended question without a specific prompt), set found=false with a reason.

The skill types are:
- rpi:create-research-questions, rpi:create-research, rpi:create-design-discussion, rpi:create-prd, rpi:create-tdd, rpi:create-structure-outline, rpi:create-plan, rpi:implement-plan, rpi:implement-outline, rpi:setup-worktree
- rpi:iterate-research-questions, rpi:iterate-research, rpi:iterate-design-discussion, rpi:iterate-structure-outline, rpi:iterate-plan, rpi:iterate-implementation
- rpi:describe-pr: For generating PR descriptions after implementation is complete
- other: Any other skill or unrecognized type

Message to analyze:
---
{messageContent}
---`

// Flat schema that Anthropic can handle (no discriminated union)
const ExtractionSchema = z.object({
	found: z.boolean().describe('Whether a next step was found'),
	reason: z.string().optional().describe('Why no next step was found (when found=false)'),
	nextStepPrompt: z.string().optional().describe('The full prompt text from the code block'),
	nextStepSummary: z.string().optional().describe('Short button label in format "skill: task-ref"'),
	nextStepType: z.string().optional().describe('The RPI skill name'),
	taskReference: z.string().optional().describe('Task identifier'),
	suggestedDirectory: z.string().optional().describe('Directory to run the prompt in'),
})

type ExtractionResult = z.infer<typeof ExtractionSchema>

// Valid nextStepType values
const VALID_SKILL_TYPES = [
	'create-research-questions',
	'create-research',
	'create-design-discussion',
	'create-prd',
	'create-tdd',
	'create-structure-outline',
	'create-plan',
	'implement-plan',
	'implement-outline',
	'setup-worktree',
	'iterate-research-questions',
	'iterate-research',
	'iterate-design-discussion',
	'iterate-structure-outline',
	'iterate-plan',
	'iterate-implementation',
	'describe-pr',
	'other',
] as const

type SkillType = (typeof VALID_SKILL_TYPES)[number]

function normalizeSkillType(value: string | undefined): SkillType {
	if (!value) return 'other'
	let normalized = value.toLowerCase().trim()
	if (normalized.startsWith('rpi:')) {
		normalized = normalized.slice('rpi:'.length)
	}
	return VALID_SKILL_TYPES.includes(normalized as SkillType) ? (normalized as SkillType) : 'other'
}

// The daemon resolves a relative path against its process cwd, so only home and absolute
// paths point to the directory the message meant.
const HOME_OR_ABSOLUTE_PATH = /^(?:~(?:\/|$)|[\\/]|[A-Za-z]:[\\/])/
// PATH_MAX on Linux.
const MAX_PATH_LENGTH = 4096
const NAME_CHAR = /[\p{L}\p{M}\p{N}_-]/u
const isSeparator = (char: string | undefined) => char === '/' || char === '\\'

// True when `path` is not a bare `/` or `\` and the message has it as a whole path, not as a part
// of a longer one. Trailing separators are ignored, because the model can add or drop one.
function namesWholePath(message: string, path: string): boolean {
	let length = path.length
	while (length > 1 && isSeparator(path[length - 1])) length--
	const name = path.slice(0, length)
	if (isSeparator(name)) return false
	for (let start = message.indexOf(name); start !== -1; start = message.indexOf(name, start + 1)) {
		const before = message[start - 1] ?? ' '
		if (NAME_CHAR.test(before) || '.~:/\\'.includes(before)) continue
		let end = start + name.length
		while (isSeparator(message[end])) end++
		const next = message[end] === '.' ? message[end + 1] : message[end]
		if (!NAME_CHAR.test(next ?? ' ')) return true
	}
	return false
}

// The model can write its reasoning (#1129) or a prompt example into this field.
function toSuggestedDirectory(value: string | undefined, messageContent: string): string | undefined {
	const directory = value?.trim()
	if (!directory || directory.length > MAX_PATH_LENGTH || /\p{Cc}/u.test(directory)) return undefined
	return HOME_OR_ABSOLUTE_PATH.test(directory) && namesWholePath(messageContent, directory) ? directory : undefined
}

export async function extractNextStep(
	messageContent: string,
	{ model = resolveModel('haiku') }: { model?: LanguageModelV3 } = {},
): Promise<NextStepSuggestion> {
	const parsedAt = Date.now()

	try {
		const prompt = EXTRACTION_PROMPT.replace('{messageContent}', messageContent)

		const { output } = await generateText({
			model,
			maxRetries: 0,
			prompt,
			output: Output.object({
				schema: ExtractionSchema,
			}),
			providerOptions: { openai: { strictJsonSchema: false } },
		})

		const result = output as ExtractionResult

		// Transform flat output to discriminated union
		const extraction: NextStepAiOutput = result.found
			? {
					type: 'next_step_found',
					nextStepPrompt: result.nextStepPrompt ?? '',
					nextStepSummary: result.nextStepSummary ?? '',
					nextStepType: normalizeSkillType(result.nextStepType),
					taskReference: result.taskReference ?? '',
					suggestedDirectory: toSuggestedDirectory(result.suggestedDirectory, messageContent),
				}
			: {
					type: 'no_next_step',
					reason: result.reason ?? 'No next step found',
				}

		return {
			parsedAt,
			extraction,
		}
	} catch (error) {
		return {
			parsedAt,
			extraction: { type: 'no_next_step', reason: 'Extraction failed' },
			extractionError: error instanceof Error ? error.message : 'Unknown error',
		}
	}
}
