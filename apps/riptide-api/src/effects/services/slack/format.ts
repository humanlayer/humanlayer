import { markdownToMrkdwn } from './markdown-to-mrkdwn'
import type {
	AutomationMessage,
	FormatArtifactSlackMessageInput,
	FormatCommentSlackMessageInput,
	SlackArtifactAutomationEventType,
	SlackBlock,
} from './slack.types'

const ARTIFACT_DETAILS: Record<SlackArtifactAutomationEventType, { label: string; square: string }> = {
	'design-discussion': { label: 'Design Discussion', square: '🟧' },
	'design-prd': { label: 'PRD', square: '🟪' },
	'design-tdd': { label: 'TDD', square: '🟩' },
	'structure-outline': { label: 'Structure Outline', square: '🟦' },
}

// Notification previews are deliberately short; longer comments are truncated with an ellipsis.
const MAX_COMMENT_PREVIEW_LENGTH = 100

/** Maps artifact frontmatter types to automation event types that Slack automations can match. */
export function artifactTypeToSlackEventType(
	artifactType: string | undefined,
): SlackArtifactAutomationEventType | null {
	if (
		artifactType === 'design-discussion' ||
		artifactType === 'design-prd' ||
		artifactType === 'design-tdd' ||
		artifactType === 'structure-outline'
	) {
		return artifactType
	}
	return null
}

/** Builds the root and reply forms of one artifact notification. */
export function formatArtifactSlackMessage(
	input: FormatArtifactSlackMessageInput,
	eventType: SlackArtifactAutomationEventType,
): AutomationMessage {
	const artifactUrl = buildArtifactDeepLink(input.appOrigin, input.event.taskId, input.event.artifactId)
	const taskUrl = buildTaskDeepLink(input.appOrigin, input.event.taskId)
	const descriptor = sectionTextBlock(formatArtifactDescriptor(input, artifactUrl, eventType))

	return {
		rootBlocks: [sectionTextBlock(formatTaskTitle(input, taskUrl)), descriptor],
		replyBlocks: [descriptor],
		broadcast: true,
	}
}

/** Builds the root and reply forms of one comment notification. */
export function formatCommentSlackMessage(input: FormatCommentSlackMessageInput): AutomationMessage {
	const preview = formatCommentPreview(input)
	const taskUrl = buildTaskDeepLink(input.appOrigin, input.event.taskId)
	const commentUrl = buildCommentDeepLink(
		input.appOrigin,
		input.event.taskId,
		input.event.artifactId,
		input.event.commentId,
	)

	const descriptor = sectionTextBlock(formatCommentDescriptor(input, commentUrl))
	const previewBlock = preview ? sectionTextBlock(preview) : null
	const rootBlocks = [sectionTextBlock(formatTaskTitle(input, taskUrl)), descriptor]
	const replyBlocks = [descriptor]
	if (previewBlock) {
		rootBlocks.push(previewBlock)
		replyBlocks.push(previewBlock)
	}
	return {
		rootBlocks,
		replyBlocks,
		broadcast: false,
	}
}

/**
 * Every comment message quotes the comment body itself: the first 100 characters as a one-line
 * `>` block. The comment is the user's prose, so reserved chars are escaped and Markdown is
 * translated to Slack mrkdwn so `**bold**`, links, etc. render. Empty comments render no quote.
 */
function formatCommentPreview(input: FormatCommentSlackMessageInput): string | null {
	const preview = markdownToMrkdwn(
		escapeMrkdwn(truncate(normalizeWhitespace(input.event.contentText), MAX_COMMENT_PREVIEW_LENGTH)),
	)
	return preview ? `> ${preview}` : null
}

/** Bold task title heading linking to the task, e.g. `*Task:* *<url|[ENG-123]: Task name>*`. */
function formatTaskTitle(
	input: FormatArtifactSlackMessageInput | FormatCommentSlackMessageInput,
	taskUrl: string,
): string {
	return `*Task:* *${mrkdwnLink(taskUrl, truncate(buildTaskLabel(input), MAX_HEADER_LENGTH))}*`
}

/**
 * Muted descriptor: colored square + artifact label + owner, with the filename on its own line —
 * linked to the artifact, and wrapping below the summary instead of breaking it mid-line.
 */
function formatArtifactDescriptor(
	input: FormatArtifactSlackMessageInput,
	artifactUrl: string,
	eventType: SlackArtifactAutomationEventType,
): string {
	const { label, square } = ARTIFACT_DETAILS[eventType]
	const ownerLabel = escapeMrkdwn(input.ownerName || input.event.resourceOwnerUserId)
	return `${square} New ${label} · ${ownerLabel}\n${mrkdwnLink(artifactUrl, input.event.fileName)}`
}

/**
 * Muted descriptor: green square + "X commented on", with the filename on its own line — linked to
 * the comment, and wrapping below the summary instead of breaking it mid-line.
 */
function formatCommentDescriptor(input: FormatCommentSlackMessageInput, commentUrl: string): string {
	const commenterLabel = escapeMrkdwn(input.commenterName || input.event.commenterUserId)
	return `🟩 *${commenterLabel} commented on*\n${mrkdwnLink(commentUrl, input.event.fileName)}`
}

// Artifact and comment links open the doc fullscreen on arrival — the reader clicked out of Slack
// specifically to read this one artifact. The plain task link stays panel-free.
function buildArtifactDeepLink(appOrigin: string, taskId: string, artifactId: string): string {
	const url = new URL(`/tasks/${taskId}`, appOrigin)
	url.searchParams.set('deep', 'true')
	url.searchParams.set('artifactId', artifactId)
	url.searchParams.set('fullscreen', 'true')
	return url.toString()
}

function buildTaskDeepLink(appOrigin: string, taskId: string): string {
	const url = new URL(`/tasks/${taskId}`, appOrigin)
	url.searchParams.set('deep', 'true')
	return url.toString()
}

function buildCommentDeepLink(appOrigin: string, taskId: string, artifactId: string, commentId: string): string {
	const url = new URL(`/tasks/${taskId}`, appOrigin)
	url.searchParams.set('deep', 'true')
	url.searchParams.set('artifactId', artifactId)
	// `comment` (not `commentId`) is the V2 viewer's reveal param — see CommentDeepLinkRouteApplier.
	url.searchParams.set('comment', commentId)
	url.searchParams.set('fullscreen', 'true')
	return url.toString()
}

function buildTaskLabel(input: FormatArtifactSlackMessageInput | FormatCommentSlackMessageInput): string {
	const taskName = input.taskName?.trim()
	const taskSlug = input.event.taskSlug?.trim()
	const taskKey = taskSlug?.match(/^([a-z]+-\d+)(?:-|$)/i)?.[1]?.toUpperCase()
	if (taskKey && taskName) return `[${taskKey}]: ${taskName}`
	return taskName || taskSlug || input.event.taskId
}

function sectionTextBlock(text: string): SlackBlock {
	return { type: 'section', text: { type: 'mrkdwn', text } }
}

/** A mrkdwn link; the label is escaped and stripped of `|` so it cannot break the link syntax. */
function mrkdwnLink(url: string, label: string): string {
	return `<${url}|${escapeMrkdwn(label).replace(/\|/g, '/')}>`
}

/** Escapes the three characters Slack reserves in `mrkdwn` so user content can't break formatting or links. */
function escapeMrkdwn(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Collapses runs of whitespace (incl. newlines) to single spaces so previews stay on one line. */
function normalizeWhitespace(text: string | undefined): string {
	return text?.replace(/\s+/g, ' ').trim() ?? ''
}

/** Truncates to a maximum visible length, appending an ellipsis when content is dropped. */
function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return `${text.slice(0, maxLength).trimEnd()}…`
}

const MAX_HEADER_LENGTH = 150
