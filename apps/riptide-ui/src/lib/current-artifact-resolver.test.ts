import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { describe, expect, test } from 'vitest'

import {
	createCurrentArtifactResolver,
	getCreatedFilePaths,
	isShareableConversationArtifact,
} from './current-artifact-resolver'

const workingDirectory = '/repo'

function toolEvent(overrides: Partial<ConversationEvent>): ConversationEvent {
	return {
		id: 'event-1',
		sessionId: 'session-1',
		eventType: 'tool_call',
		createdAt: new Date(0),
		role: 'assistant',
		isCompleted: true,
		...overrides,
	}
}

describe('createCurrentArtifactResolver', () => {
	test('matches exact relative and absolute paths, including nested artifacts', () => {
		const artifact = {
			id: 'nested',
			path: '.humanlayer/tasks/task-slug/reviews/nested.md',
		}
		const resolve = createCurrentArtifactResolver({ workingDirectory, artifacts: [artifact] })

		expect(resolve('.humanlayer/tasks/task-slug/reviews/nested.md')).toBe(artifact)
		expect(resolve('/repo/.humanlayer/tasks/task-slug/reviews/nested.md')).toBe(artifact)
	})

	test('rejects zero matches, paths outside the task directory, and traversal outside the workspace', () => {
		const resolve = createCurrentArtifactResolver({
			workingDirectory,
			artifacts: [{ id: 'artifact-1', path: '.humanlayer/tasks/task-slug/doc.md' }],
		})

		expect(resolve('.humanlayer/tasks/task-slug/missing.md')).toBeNull()
		expect(resolve('/repo/README.md')).toBeNull()
		expect(resolve('../../outside.md')).toBeNull()
	})

	test('rejects ambiguous matches and deleted artifacts', () => {
		const duplicatePath = '.humanlayer/tasks/task-slug/doc.md'
		const ambiguous = createCurrentArtifactResolver({
			workingDirectory,
			artifacts: [
				{ id: 'artifact-1', path: duplicatePath },
				{ id: 'artifact-2', path: duplicatePath },
			],
		})
		const deleted = createCurrentArtifactResolver({
			workingDirectory,
			artifacts: [{ id: 'artifact-1', path: duplicatePath, isDeleted: true }],
		})

		expect(ambiguous(duplicatePath)).toBeNull()
		expect(deleted(duplicatePath)).toBeNull()
	})
})

describe('getCreatedFilePaths', () => {
	test('requires completed Write creation evidence', () => {
		const write = toolEvent({
			toolName: 'Write',
			toolInputJson: JSON.stringify({ file_path: '/repo/new.md', content: 'new' }),
		})

		expect(
			getCreatedFilePaths(write, toolEvent({ toolResultContent: 'File created successfully at: /repo/new.md' })),
		).toEqual(['/repo/new.md'])
		expect(
			getCreatedFilePaths(write, toolEvent({ toolResultContent: 'The file /repo/new.md has been updated.' })),
		).toEqual([])
		expect(getCreatedFilePaths({ ...write, isCompleted: false })).toEqual([])
	})

	test('returns only ApplyPatch Add paths', () => {
		const patch = toolEvent({
			toolName: 'apply_patch',
			toolInputJson: JSON.stringify({
				patch_text: `*** Begin Patch
*** Add File: add.md
+new
*** Update File: update.md
@@
-old
+new
*** Delete File: delete.md
*** Update File: old.md
*** Move to: moved.md
*** End Patch`,
			}),
		})

		expect(getCreatedFilePaths(patch)).toEqual(['add.md'])
	})

	test('does not treat Edit as file creation', () => {
		expect(getCreatedFilePaths(toolEvent({ toolName: 'Edit', toolInputJson: '{}' }))).toEqual([])
	})
})

describe('isShareableConversationArtifact', () => {
	test.each(['design-discussion', 'design-prd', 'design-tdd', 'structure-outline'])(
		'allows the exact %s frontmatter type',
		(frontmatterType) => {
			expect(isShareableConversationArtifact({ id: 'artifact', path: 'artifact.md', frontmatterType })).toBe(true)
		},
	)

	test.each(['research', 'plan', 'ticket', 'Design-PRD', null])('does not allow %s', (frontmatterType) => {
		expect(isShareableConversationArtifact({ id: 'artifact', path: 'artifact.md', frontmatterType })).toBe(false)
	})
})
