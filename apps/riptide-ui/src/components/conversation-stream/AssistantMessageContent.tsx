import type { FC } from 'react'

import { MarkdownRenderer } from '../MarkdownRenderer'

export interface AssistantMessageContentProps {
	content: string
	isThinking?: boolean
	streaming?: boolean
}

export const AssistantMessageContent: FC<AssistantMessageContentProps> = ({ content, isThinking, streaming }) => {
	// Strip thinking tags if present
	let displayContent = content
	if (content.startsWith('<thinking>')) {
		const endTag = content.indexOf('</thinking>')
		if (endTag !== -1) {
			displayContent = content.slice(endTag + 11).trim()
		}
	}
	if (isThinking && !displayContent.trim()) {
		displayContent = 'thinking'
	}

	return (
		<div
			className={`text-sm [&_p]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_pre]:mb-2 ${isThinking ? 'text-muted-foreground italic' : ''}`}
		>
			<MarkdownRenderer content={displayContent} preserveSingleLineBreaks preserveXmlTags streaming={streaming} />
		</div>
	)
}
