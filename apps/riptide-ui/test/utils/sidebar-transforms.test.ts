import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { describe, expect, test } from 'vitest'

import {
	classifyDbArtifacts,
	eventsToMinimapEvents,
	extractArtifactsFromEvents,
	extractOperationsByFilename,
	isForkExcludedMessage,
	isLocalCommandMessage,
	isRequestInterruptedByUserMessage,
	isSyntheticSkillPromptMessage,
} from '../../src/utils/sidebar-transforms'

function createToolCallEvent(toolName: string, input: Record<string, unknown>): ConversationEvent {
	return {
		id: `event-${Math.random()}`,
		eventType: 'tool_call',
		toolName,
		toolInputJson: JSON.stringify(input),
		role: 'assistant',
	} as ConversationEvent
}

function createApplyPatchEvent(
	patchText: string,
	inputKey: 'patch_text' | 'patchText' = 'patch_text',
): ConversationEvent {
	return createToolCallEvent('apply_patch', { [inputKey]: patchText })
}

describe('isLocalCommandMessage', () => {
	test('returns true for local-command-stdout content', () => {
		expect(isLocalCommandMessage('<local-command-stdout>Set model to sonnet</local-command-stdout>')).toBe(true)
	})

	test('returns true with leading whitespace', () => {
		expect(isLocalCommandMessage('  <local-command-stdout>Set model to opus</local-command-stdout>')).toBe(true)
	})

	test('returns false for normal user messages', () => {
		expect(isLocalCommandMessage('Fix the bug in sidebar')).toBe(false)
	})

	test('returns false for null/undefined', () => {
		expect(isLocalCommandMessage(null)).toBe(false)
		expect(isLocalCommandMessage(undefined)).toBe(false)
	})

	test('returns false for empty string', () => {
		expect(isLocalCommandMessage('')).toBe(false)
	})
})

describe('isSyntheticSkillPromptMessage', () => {
	test('returns true for skill prompt prefix', () => {
		expect(isSyntheticSkillPromptMessage('Base directory for this skill: /tmp/task')).toBe(true)
	})

	test('returns false for normal user messages', () => {
		expect(isSyntheticSkillPromptMessage('Please continue with phase 2')).toBe(false)
	})

	test('returns false for null/undefined', () => {
		expect(isSyntheticSkillPromptMessage(null)).toBe(false)
		expect(isSyntheticSkillPromptMessage(undefined)).toBe(false)
	})
})

describe('isForkExcludedMessage', () => {
	test('returns true for local-command content', () => {
		expect(isForkExcludedMessage('<local-command-stdout>Set model</local-command-stdout>')).toBe(true)
	})

	test('returns true for synthetic skill prompt content', () => {
		expect(isForkExcludedMessage('Base directory for this skill: /tmp/task')).toBe(true)
	})

	test('returns false for normal user messages', () => {
		expect(isForkExcludedMessage('Please continue with phase 2')).toBe(false)
	})

	test('returns true for request interrupted by user messages', () => {
		expect(isForkExcludedMessage('request interrupted by user')).toBe(true)
		expect(isForkExcludedMessage('The REQUEST INTERRUPTED BY USER signal happened')).toBe(true)
	})
})

describe('isRequestInterruptedByUserMessage', () => {
	test('returns true when marker appears in any case', () => {
		expect(isRequestInterruptedByUserMessage('request interrupted by user')).toBe(true)
		expect(isRequestInterruptedByUserMessage('REQUEST INTERRUPTED BY USER')).toBe(true)
	})

	test('returns false for non-matching content and nullish input', () => {
		expect(isRequestInterruptedByUserMessage('please continue')).toBe(false)
		expect(isRequestInterruptedByUserMessage(null)).toBe(false)
		expect(isRequestInterruptedByUserMessage(undefined)).toBe(false)
	})
})

describe('eventsToMinimapEvents', () => {
	test('filters out local-command-stdout messages', () => {
		const events: ConversationEvent[] = [
			{
				id: 'msg-1',
				eventType: 'message',
				role: 'user',
				content: 'Hello',
			} as ConversationEvent,
			{
				id: 'msg-2',
				eventType: 'message',
				role: 'user',
				content: '<local-command-stdout>Set model to sonnet</local-command-stdout>',
			} as ConversationEvent,
			{
				id: 'msg-3',
				eventType: 'message',
				role: 'assistant',
				content: 'Hi there',
			} as ConversationEvent,
		]
		const result = eventsToMinimapEvents(events)
		expect(result.map((e) => e.id)).toEqual(['msg-1', 'msg-3'])
	})
})

describe('extractArtifactsFromEvents', () => {
	test('extracts Read operations on thoughts/ files', () => {
		const events = [createToolCallEvent('Read', { file_path: 'thoughts/tasks/eng-123/research.md' })]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts).toEqual([{ path: 'thoughts/tasks/eng-123/research.md', categories: ['source'] }])
	})

	test('extracts Read operations on .humanlayer/tasks/ files', () => {
		const events = [createToolCallEvent('Read', { file_path: '.humanlayer/tasks/eng-456/design.md' })]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts).toEqual([{ path: '.humanlayer/tasks/eng-456/design.md', categories: ['source'] }])
	})

	test('filters out non-artifact paths', () => {
		const events = [
			createToolCallEvent('Read', { file_path: 'src/components/Button.tsx' }),
			createToolCallEvent('Read', { file_path: 'thoughts/tasks/eng-123/research.md' }),
			createToolCallEvent('Read', { file_path: 'packages/ui/index.ts' }),
		]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts.length).toBe(1)
		expect(artifacts[0].path).toBe('thoughts/tasks/eng-123/research.md')
	})

	test('tracks Read → Edit sequence as source + edited', () => {
		const events = [
			createToolCallEvent('Read', { file_path: 'thoughts/tasks/eng-123/plan.md' }),
			createToolCallEvent('Edit', {
				file_path: 'thoughts/tasks/eng-123/plan.md',
				old_string: 'old',
				new_string: 'new',
			}),
		]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts).toEqual([{ path: 'thoughts/tasks/eng-123/plan.md', categories: ['source', 'edited'] }])
	})

	test('tracks Write-first as new', () => {
		const events = [
			createToolCallEvent('Write', { file_path: '.humanlayer/tasks/eng-789/new-doc.md', content: '# New' }),
		]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts).toEqual([{ path: '.humanlayer/tasks/eng-789/new-doc.md', categories: ['new'] }])
	})

	test('deduplicates files with multiple operations', () => {
		const events = [
			createToolCallEvent('Read', { file_path: 'thoughts/tasks/eng-123/doc.md' }),
			createToolCallEvent('Read', { file_path: 'thoughts/tasks/eng-123/doc.md' }),
			createToolCallEvent('Edit', {
				file_path: 'thoughts/tasks/eng-123/doc.md',
				old_string: 'a',
				new_string: 'b',
			}),
		]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts.length).toBe(1)
		expect(artifacts[0].path).toBe('thoughts/tasks/eng-123/doc.md')
	})

	test('handles empty events array', () => {
		expect(extractArtifactsFromEvents([])).toEqual([])
	})

	test('extracts artifact path from absolute paths', () => {
		const events = [createToolCallEvent('Read', { file_path: '/Users/test/project/thoughts/notes.md' })]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts).toEqual([{ path: 'thoughts/notes.md', categories: ['source'] }])
	})

	test('handles MultiEdit with multiple files', () => {
		const events = [
			createToolCallEvent('MultiEdit', {
				edits: [
					{ file_path: 'thoughts/doc1.md', old_string: 'a', new_string: 'b' },
					{ file_path: 'thoughts/doc2.md', old_string: 'c', new_string: 'd' },
					{ file_path: 'src/code.ts', old_string: 'x', new_string: 'y' },
				],
			}),
		]
		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts.length).toBe(2)
		expect(artifacts.map((a) => a.path).sort()).toEqual(['thoughts/doc1.md', 'thoughts/doc2.md'])
	})

	test('extracts apply_patch artifact categories from events', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Add File: .humanlayer/tasks/eng-123/new-artifact.md',
					'+# New artifact',
					'*** Update File: .humanlayer/tasks/eng-123/edited-artifact.md',
					'@@',
					'-old',
					'+new',
					'*** End Patch',
				].join('\n'),
			),
		]

		const artifacts = extractArtifactsFromEvents(events)
		expect(artifacts).toEqual([
			{ path: '.humanlayer/tasks/eng-123/new-artifact.md', categories: ['new'] },
			{ path: '.humanlayer/tasks/eng-123/edited-artifact.md', categories: ['edited'] },
		])
	})
})

describe('extractOperationsByFilename', () => {
	test('extracts operations keyed by filename', () => {
		const events = [
			createToolCallEvent('Read', { file_path: '.humanlayer/tasks/eng-123/plan.md' }),
			createToolCallEvent('Edit', {
				file_path: '.humanlayer/tasks/eng-123/plan.md',
				old_string: 'a',
				new_string: 'b',
			}),
		]
		const ops = extractOperationsByFilename(events)
		expect(ops.get('plan.md')).toEqual(['Read', 'Edit'])
	})

	test('handles multiple files', () => {
		const events = [
			createToolCallEvent('Read', { file_path: '.humanlayer/tasks/eng-123/plan.md' }),
			createToolCallEvent('Write', { file_path: '.humanlayer/tasks/eng-456/new.md', content: '# New' }),
		]
		const ops = extractOperationsByFilename(events)
		expect(ops.get('plan.md')).toEqual(['Read'])
		expect(ops.get('new.md')).toEqual(['Write'])
	})

	test('canonicalizes lowercase and snake_case tool names', () => {
		const events = [
			createToolCallEvent('read', { file_path: '.humanlayer/tasks/task-1/plan.md' }),
			createToolCallEvent('multi_edit', {
				edits: [{ file_path: '.humanlayer/tasks/task-1/plan.md', old_string: 'a', new_string: 'b' }],
			}),
		]
		const ops = extractOperationsByFilename(events)
		expect(ops.get('plan.md')).toEqual(['Read', 'MultiEdit'])
	})

	test('handles double-encoded tool input json', () => {
		const event = createToolCallEvent('read', { file_path: '.humanlayer/tasks/task-1/plan.md' })
		event.toolInputJson = JSON.stringify(event.toolInputJson)
		const ops = extractOperationsByFilename([event])
		expect(ops.get('plan.md')).toEqual(['Read'])
	})

	test('ignores non-artifact paths', () => {
		const events = [
			createToolCallEvent('Read', { file_path: 'src/index.ts' }),
			createToolCallEvent('Read', { file_path: '.humanlayer/tasks/eng-123/research.md' }),
		]
		const ops = extractOperationsByFilename(events)
		expect(ops.size).toBe(1)
		expect(ops.get('research.md')).toEqual(['Read'])
	})

	test('handles empty events', () => {
		const ops = extractOperationsByFilename([])
		expect(ops.size).toBe(0)
	})

	test('extracts apply_patch Add File operations keyed by filename', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Add File: .humanlayer/tasks/eng-123/new-artifact.md',
					'+# New artifact',
					'*** End Patch',
				].join('\n'),
			),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.get('new-artifact.md')).toEqual(['Write'])
	})

	test('extracts apply_patch Update File operations as edits', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Update File: .humanlayer/tasks/eng-123/updated-artifact.md',
					'@@',
					'-old',
					'+new',
					'*** End Patch',
				].join('\n'),
			),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.get('updated-artifact.md')).toEqual(['Edit'])
	})

	test('extracts apply_patch Delete File operations as edits', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Delete File: .humanlayer/tasks/eng-123/deleted-artifact.md',
					'*** End Patch',
				].join('\n'),
			),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.get('deleted-artifact.md')).toEqual(['Edit'])
	})

	test('uses apply_patch Move to destination filename as an edit', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Update File: .humanlayer/tasks/eng-123/original-artifact.md',
					'*** Move to: .humanlayer/tasks/eng-123/moved-artifact.md',
					'@@',
					'-old',
					'+new',
					'*** End Patch',
				].join('\n'),
			),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.has('original-artifact.md')).toBe(false)
		expect(ops.get('moved-artifact.md')).toEqual(['Edit'])
	})

	test('extracts apply_patch operations from camelCase patchText input', () => {
		const events = [
			createApplyPatchEvent(
				['*** Begin Patch', '*** Update File: .humanlayer/tasks/eng-123/camel-case.md', '*** End Patch'].join(
					'\n',
				),
				'patchText',
			),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.get('camel-case.md')).toEqual(['Edit'])
	})

	test('handles double-encoded apply_patch tool input json', () => {
		const event = createApplyPatchEvent(
			['*** Begin Patch', '*** Update File: .humanlayer/tasks/eng-123/double-encoded.md', '*** End Patch'].join(
				'\n',
			),
		)
		event.toolInputJson = JSON.stringify(event.toolInputJson)

		const ops = extractOperationsByFilename([event])
		expect(ops.get('double-encoded.md')).toEqual(['Edit'])
	})

	test('ignores non-artifact apply_patch paths and deduplicates equivalent artifact paths', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Update File: src/not-an-artifact.md',
					'*** Update File: .humanlayer/tasks/eng-123/deduped.md',
					'*** Update File: /Users/test/repo/.humanlayer/tasks/eng-123/deduped.md',
					'*** End Patch',
				].join('\n'),
			),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.size).toBe(1)
		expect(ops.get('deduped.md')).toEqual(['Edit'])
	})

	test('extracts apply_patch operations from absolute artifact paths', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Update File: /Users/test/repo/.humanlayer/tasks/eng-123/absolute-artifact.md',
					'*** End Patch',
				].join('\n'),
			),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.get('absolute-artifact.md')).toEqual(['Edit'])
	})

	test('keeps direct file operation classification unchanged with unrelated apply_patch events', () => {
		const events = [
			createToolCallEvent('Read', { file_path: '.humanlayer/tasks/eng-123/source.md' }),
			createToolCallEvent('Edit', {
				file_path: '.humanlayer/tasks/eng-123/source.md',
				old_string: 'old',
				new_string: 'new',
			}),
			createToolCallEvent('Write', { file_path: '.humanlayer/tasks/eng-123/new.md', content: '# New' }),
			createToolCallEvent('MultiEdit', {
				edits: [{ file_path: '.humanlayer/tasks/eng-123/multi.md', old_string: 'old', new_string: 'new' }],
			}),
			createApplyPatchEvent(['*** Begin Patch', '*** Update File: src/unrelated.ts', '*** End Patch'].join('\n')),
		]

		const ops = extractOperationsByFilename(events)
		expect(ops.get('source.md')).toEqual(['Read', 'Edit'])
		expect(ops.get('new.md')).toEqual(['Write'])
		expect(ops.get('multi.md')).toEqual(['MultiEdit'])
		expect(ops.size).toBe(3)
	})
})

describe('classifyDbArtifacts', () => {
	test('classifies artifacts with matching operations', () => {
		const dbArtifacts = [
			{ id: 'art-1', file_name: 'plan.md', task_slug: 'eng-123' },
			{ id: 'art-2', file_name: 'research.md', task_slug: 'eng-123' },
		]
		const operations = new Map([
			['plan.md', ['Read', 'Edit'] as const],
			['research.md', ['Read'] as const],
		])

		const result = classifyDbArtifacts(
			dbArtifacts,
			operations as Map<string, ('Read' | 'Edit' | 'Write' | 'MultiEdit')[]>,
		)

		expect(result).toEqual([
			{
				id: 'art-1',
				path: '.humanlayer/tasks/eng-123/plan.md',
				categories: ['source', 'edited'],
				frontmatterType: null,
			},
			{
				id: 'art-2',
				path: '.humanlayer/tasks/eng-123/research.md',
				categories: ['source'],
				frontmatterType: null,
			},
		])
	})

	test('treats lowercase CodeLayer reads as source', () => {
		const dbArtifacts = [{ id: 'art-1', file_name: 'plan.md', task_slug: 'task-1' }]
		const operations = new Map([['plan.md', ['read' as unknown as 'Read' | 'Edit' | 'Write' | 'MultiEdit']]])

		const result = classifyDbArtifacts(
			dbArtifacts,
			operations as Map<string, ('Read' | 'Edit' | 'Write' | 'MultiEdit')[]>,
		)

		expect(result).toEqual([
			{ id: 'art-1', path: '.humanlayer/tasks/task-1/plan.md', categories: ['source'], frontmatterType: null },
		])
	})

	test('returns unreferenced category when no operations found', () => {
		const dbArtifacts = [{ id: 'art-1', file_name: 'untouched.md', task_slug: 'eng-789' }]
		const operations = new Map<string, ('Read' | 'Edit' | 'Write' | 'MultiEdit')[]>()

		const result = classifyDbArtifacts(dbArtifacts, operations)

		// Artifacts with no operations are marked 'unreferenced' so they still appear in sidebar
		expect(result).toEqual([
			{
				id: 'art-1',
				path: '.humanlayer/tasks/eng-789/untouched.md',
				categories: ['unreferenced'],
				resourceOwnerUserId: undefined,
				shareKey: undefined,
				shareEnabled: undefined,
				storageType: undefined,
				frontmatterType: null,
			},
		])
	})

	test('handles artifacts without task_slug', () => {
		const dbArtifacts = [{ id: 'art-1', file_name: 'orphan.md', task_slug: null }]
		const operations = new Map([['orphan.md', ['Write'] as const]])

		const result = classifyDbArtifacts(
			dbArtifacts,
			operations as Map<string, ('Read' | 'Edit' | 'Write' | 'MultiEdit')[]>,
		)

		expect(result).toEqual([{ id: 'art-1', path: 'orphan.md', categories: ['new'], frontmatterType: null }])
	})

	test('handles empty dbArtifacts', () => {
		const operations = new Map([['plan.md', ['Read'] as const]])
		const result = classifyDbArtifacts([], operations as Map<string, ('Read' | 'Edit' | 'Write' | 'MultiEdit')[]>)
		expect(result).toEqual([])
	})

	test('classifies apply_patch Add File artifacts as new', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Add File: .humanlayer/tasks/eng-123/new-artifact.md',
					'+# New artifact',
					'*** End Patch',
				].join('\n'),
			),
		]
		const dbArtifacts = [{ id: 'art-1', file_name: 'new-artifact.md', task_slug: 'eng-123' }]

		const operations = extractOperationsByFilename(events)
		const result = classifyDbArtifacts(dbArtifacts, operations)

		expect(result).toEqual([
			{
				id: 'art-1',
				path: '.humanlayer/tasks/eng-123/new-artifact.md',
				categories: ['new'],
				frontmatterType: null,
			},
		])
	})

	test('classifies apply_patch Update File artifacts as edited', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Update File: .humanlayer/tasks/eng-123/updated-artifact.md',
					'*** End Patch',
				].join('\n'),
			),
		]
		const dbArtifacts = [{ id: 'art-1', file_name: 'updated-artifact.md', task_slug: 'eng-123' }]

		const operations = extractOperationsByFilename(events)
		const result = classifyDbArtifacts(dbArtifacts, operations)

		expect(result).toEqual([
			{
				id: 'art-1',
				path: '.humanlayer/tasks/eng-123/updated-artifact.md',
				categories: ['edited'],
				frontmatterType: null,
			},
		])
	})

	test('classifies apply_patch Move to destination artifacts as edited', () => {
		const events = [
			createApplyPatchEvent(
				[
					'*** Begin Patch',
					'*** Update File: .humanlayer/tasks/eng-123/original-artifact.md',
					'*** Move to: .humanlayer/tasks/eng-123/moved-artifact.md',
					'*** End Patch',
				].join('\n'),
			),
		]
		const dbArtifacts = [{ id: 'art-1', file_name: 'moved-artifact.md', task_slug: 'eng-123' }]

		const operations = extractOperationsByFilename(events)
		const result = classifyDbArtifacts(dbArtifacts, operations)

		expect(result).toEqual([
			{
				id: 'art-1',
				path: '.humanlayer/tasks/eng-123/moved-artifact.md',
				categories: ['edited'],
				frontmatterType: null,
			},
		])
	})
})
