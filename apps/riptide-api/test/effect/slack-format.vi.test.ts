import { describe, expect, it } from 'vitest'

import { formatArtifactSlackMessage, formatCommentSlackMessage } from '../../src/effects/services/slack/format'
import type {
	FormatArtifactSlackMessageInput,
	FormatCommentSlackMessageInput,
	SlackArtifactAutomationEventType,
	SlackBlock,
} from '../../src/effects/services/slack/slack.types'

const artifactInput = (
	artifactType: SlackArtifactAutomationEventType = 'structure-outline',
): FormatArtifactSlackMessageInput => ({
	appOrigin: 'https://app.example.com',
	taskName: 'Ship Slack updates',
	ownerName: 'Ada Lovelace',
	event: {
		organizationId: 'org_123',
		taskId: 'task_123',
		taskSlug: 'core-1340-ship-slack-updates',
		artifactId: 'artifact_123',
		fileName: 'plan.md',
		artifactType,
		resourceOwnerUserId: 'user_owner',
		actorUserId: 'user_actor',
		created: true,
	},
})

const commentInput = (
	overrides: Partial<FormatCommentSlackMessageInput['event']> = {},
): FormatCommentSlackMessageInput => ({
	appOrigin: 'https://app.example.com',
	taskName: 'Ship Slack updates',
	commenterName: 'Grace Hopper',
	event: {
		organizationId: 'org_123',
		taskId: 'task_123',
		taskSlug: 'core-1340-ship-slack-updates',
		artifactId: 'artifact_123',
		fileName: 'plan.md',
		commentId: 'comment_123',
		resourceOwnerUserId: 'user_owner',
		commenterUserId: 'user_commenter',
		contentText: 'Agree — can we make this **idempotent**?',
		quotedText: 'the injection step should run first',
		...overrides,
	},
})

const blockText = (block: SlackBlock | undefined): string => (block?.text as { text?: string } | undefined)?.text ?? ''

const blockLinks = (block: SlackBlock | undefined): Array<{ url: string; label: string }> =>
	[...blockText(block).matchAll(/<([^|>]+)\|([^>]+)>/g)].map((match) => ({
		url: match[1] ?? '',
		label: match[2] ?? '',
	}))

describe('Slack artifact formatting', () => {
	it('roots lead with the linked task title and a descriptor whose filename links to the artifact', () => {
		const { rootBlocks: blocks } = formatArtifactSlackMessage(artifactInput(), 'structure-outline')

		expect(blocks).toHaveLength(2)
		const [titleLink] = blockLinks(blocks[0])
		expect(titleLink?.label).toBe('[CORE-1340]: Ship Slack updates')
		expect(blockText(blocks[0])).toBe(`*Task:* *<${titleLink?.url}|[CORE-1340]: Ship Slack updates>*`)
		const [fileLink] = blockLinks(blocks[1])
		expect(fileLink?.label).toBe('plan.md')
		expect(blockText(blocks[1])).toBe(`🟦 New Structure Outline · Ada Lovelace\n<${fileLink?.url}|plan.md>`)
	})

	it('replies drop the task title and keep only the descriptor with the linked filename', () => {
		const input = artifactInput()
		const { rootBlocks: root, replyBlocks: reply } = formatArtifactSlackMessage(input, 'structure-outline')

		expect(reply).toHaveLength(1)
		expect(blockText(reply[0])).toBe(blockText(root[1]))
		expect(blockLinks(reply[0]).map((link) => link.label)).toEqual(['plan.md'])
		expect(reply.map(blockText)).not.toContain(blockText(root[0]))
	})

	it.each([
		['structure-outline', '🟦 New Structure Outline'],
		['design-prd', '🟪 New PRD'],
		['design-tdd', '🟩 New TDD'],
		['design-discussion', '🟧 New Design Discussion'],
	] as const)('shows the %s colored square in the descriptor', (artifactType, expectedPrefix) => {
		const { rootBlocks: blocks } = formatArtifactSlackMessage(artifactInput(artifactType), artifactType)
		expect(blockText(blocks[1]).startsWith(expectedPrefix)).toBe(true)
	})

	it('the filename link carries fullscreen=true while the task title link does not', () => {
		const { rootBlocks: blocks } = formatArtifactSlackMessage(artifactInput(), 'structure-outline')
		const [taskUrl] = blockLinks(blocks[0]).map((link) => new URL(link.url))
		const [artifactUrl] = blockLinks(blocks[1]).map((link) => new URL(link.url))

		expect(artifactUrl?.searchParams.get('deep')).toBe('true')
		expect(artifactUrl?.searchParams.get('artifactId')).toBe('artifact_123')
		expect(artifactUrl?.searchParams.get('fullscreen')).toBe('true')
		expect(taskUrl?.searchParams.get('deep')).toBe('true')
		expect(taskUrl?.searchParams.get('fullscreen')).toBeNull()
	})
})

describe('Slack comment formatting', () => {
	it('roots carry the linked task title, descriptor with the filename linked to the comment, and preview', () => {
		const { rootBlocks: blocks } = formatCommentSlackMessage(commentInput())

		expect(blocks).toHaveLength(3)
		expect(blockLinks(blocks[0]).map((link) => link.label)).toEqual(['[CORE-1340]: Ship Slack updates'])
		const [fileLink] = blockLinks(blocks[1])
		expect(fileLink?.label).toBe('plan.md')
		expect(blockText(blocks[1])).toBe(`🟩 *Grace Hopper commented on*\n<${fileLink?.url}|plan.md>`)
		expect(blockText(blocks[2])).toBe('> Agree — can we make this *idempotent*?')
	})

	it('quotes only the first 100 characters of the comment body', () => {
		const { rootBlocks: blocks } = formatCommentSlackMessage(commentInput({ contentText: 'x'.repeat(150) }))

		expect(blockText(blocks[2])).toBe(`> ${'x'.repeat(100)}…`)
	})

	it('roots omit the quote block when the comment body is empty', () => {
		const { rootBlocks: blocks } = formatCommentSlackMessage(
			commentInput({ quotedText: undefined, contentText: '   ' }),
		)

		expect(blocks).toHaveLength(2)
		expect(blockText(blocks[1]).startsWith('🟩 *Grace Hopper commented on*\n')).toBe(true)
	})

	it('replies carry the descriptor with linked filename and the quoted preview — no title or doc text', () => {
		const { rootBlocks: root, replyBlocks: reply } = formatCommentSlackMessage(commentInput())

		expect(reply).toHaveLength(2)
		expect(blockText(reply[0])).toBe(blockText(root[1]))
		expect(blockText(reply[1])).toBe('> Agree — can we make this *idempotent*?')
		const replyText = reply.map(blockText).join('\n')
		expect(replyText).not.toContain('Ship Slack updates')
		expect(replyText).not.toContain('injection step')
	})

	it('the filename link carries fullscreen, artifact, and comment ids', () => {
		const { replyBlocks: reply } = formatCommentSlackMessage(commentInput())
		const [commentUrl] = blockLinks(reply[0]).map((link) => new URL(link.url))

		expect(commentUrl?.pathname).toBe('/tasks/task_123')
		expect(commentUrl?.searchParams.get('deep')).toBe('true')
		expect(commentUrl?.searchParams.get('artifactId')).toBe('artifact_123')
		expect(commentUrl?.searchParams.get('comment')).toBe('comment_123')
		expect(commentUrl?.searchParams.get('fullscreen')).toBe('true')
	})
})
