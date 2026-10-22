import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import type { ConversationSender } from '@humanlayer/ui/components/conversation-stream'
import type { FC } from 'react'

import { getArtifactDisplayName, TASK_ARTIFACT_MENTION_PATTERN } from '@/lib/task-artifact-path'

import { MarkdownRenderer } from '../MarkdownRenderer'

export interface UserMessageContentProps {
	content: string
	sender: ConversationSender | undefined
	truncate?: boolean
}

function shortenArtifactMentions(content: string): string {
	return content.replace(
		TASK_ARTIFACT_MENTION_PATTERN,
		(_mention, path: string) => `@${getArtifactDisplayName(path)}`,
	)
}

export const UserMessageContent: FC<UserMessageContentProps> = ({ content, sender, truncate = false }) => {
	const renderedContent = truncate ? (
		<div className="line-clamp-2 whitespace-pre-wrap">{shortenArtifactMentions(content.trim())}</div>
	) : (
		<MarkdownRenderer content={content} preserveSingleLineBreaks preserveXmlTags artifactMentions />
	)

	return (
		<div className="text-sm whitespace-pre-wrap break-words">
			{sender ? (
				<div className="flex items-start gap-2" data-testid="message-sender-layout">
					<Avatar className="size-5 shrink-0" title={sender.displayName}>
						<AvatarImage src={sender.profilePictureUrl} alt={sender.displayName} />
						<AvatarFallback className="text-[9px]">{sender.initials}</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1">
						<div
							className="flex h-5 items-center text-xs font-medium leading-none text-muted-foreground"
							data-testid="message-sender-name"
						>
							{sender.displayName}
						</div>
						{renderedContent}
					</div>
				</div>
			) : (
				renderedContent
			)}
		</div>
	)
}
