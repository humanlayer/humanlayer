import type React from 'react'
import { getInitials } from '../lib/comment-utils'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'

interface CommentedLineProps {
	children: React.ReactNode
	commentAuthors: Array<{ userId: string; displayName?: string; avatarUrl?: string }>
	onClick?: () => void
	multiline?: boolean
	/** 'line' (default): full background highlight. 'block': subtle left border for paragraph-level indicators */
	variant?: 'line' | 'block'
	/** Source line number — rendered as data-source-line attribute for position measurement */
	sourceLineNumber?: number
	/** Whether to show the avatar badge (default: true). Set to false for continuation lines in a group. */
	showBadge?: boolean
}

export function CommentedLine({ children, commentAuthors, onClick, multiline, variant = 'line', sourceLineNumber, showBadge = true }: CommentedLineProps) {
	const isBlock = variant === 'block'
	return (
		<div
			data-source-line={sourceLineNumber}
			className={
				isBlock
					? 'group border-l-2 border-[var(--terminal-warning)] pl-2 relative cursor-pointer transition-colors hover:bg-[var(--terminal-warning)]/5'
					: `group bg-[var(--terminal-warning)]/10 hover:bg-[var(--terminal-warning)]/20 cursor-pointer transition-colors relative ${multiline ? '' : 'flex items-center gap-1'}`
			}
			style={isBlock ? undefined : multiline ? undefined : { paddingTop: '2px', paddingBottom: '2px', paddingRight: '4px' }}
			onClick={onClick}
		>
			<div className="flex-1 min-w-0 [&>*]:!mb-0 [&>*]:!mt-0 pr-6">{children}</div>
			{showBadge && (
				<div className={`flex items-center [&_img]:!m-0 [&_img]:!h-full [&_img]:!max-w-none [&_img]:!rounded-none ${multiline || isBlock ? 'absolute top-1 right-1' : 'flex-shrink-0'}`}>
					<div className="flex items-center">
						{commentAuthors.slice(0, 3).map((author, index) => (
							<Avatar
								key={author.userId}
								className="size-4 border border-border"
								style={index > 0 ? { marginLeft: '-6px' } : undefined}
								title={author.displayName}
							>
								<AvatarImage src={author.avatarUrl} alt={author.displayName ?? author.userId} className="absolute inset-0 object-cover" />
								<AvatarFallback className="text-[7px]">
									{getInitials(author.displayName ?? author.userId)}
								</AvatarFallback>
							</Avatar>
						))}
					</div>
					{commentAuthors.length > 3 && (
						<Avatar
							className="size-4 border border-border"
							style={{ marginLeft: '-6px' }}
						>
							<AvatarFallback className="text-[7px] bg-muted">
								+{commentAuthors.length - 3}
							</AvatarFallback>
						</Avatar>
					)}
				</div>
			)}
		</div>
	)
}
