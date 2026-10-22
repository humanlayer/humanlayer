import { MessageCircle, MessageSquareDiff, Reply, ServerCrash, Users } from 'lucide-react'
import { memo } from 'react'

import { getInitials } from '../../lib/comment-utils'
import { cn } from '../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../avatar'
import { renderSessionStatusIndicator, UnreadBullet } from '../sidebar/status-indicators'

export type NotificationRowKind =
	| 'approval'
	| 'ready_for_input'
	| 'session_failed'
	| 'workspace_setup_failed'
	| 'prompt_invite'
	| 'artifact_comment'
	| 'thread_reply'
	| 'diff_comment'

const PERSON_ICON_CLASS = 'size-3.5 text-[var(--terminal-accent)]'

export function NotificationKindIcon({ kind }: { kind: NotificationRowKind }) {
	switch (kind) {
		case 'approval':
			return renderSessionStatusIndicator('needs_approval')
		case 'ready_for_input':
			return <UnreadBullet />
		case 'session_failed':
			return renderSessionStatusIndicator('failed')
		case 'workspace_setup_failed':
			return <ServerCrash className="size-3.5 text-[var(--terminal-error)]" strokeWidth={2} />
		case 'prompt_invite':
			return <Users className={PERSON_ICON_CLASS} strokeWidth={2} />
		case 'artifact_comment':
			return <MessageCircle className={PERSON_ICON_CLASS} strokeWidth={2} />
		case 'thread_reply':
			return <Reply className={PERSON_ICON_CLASS} strokeWidth={2} />
		case 'diff_comment':
			return <MessageSquareDiff className={PERSON_ICON_CLASS} strokeWidth={2} />
	}
}

export interface NotificationRowProps {
	id: string
	kind: NotificationRowKind
	actorName: string | null
	actorAvatarUrl: string | null
	action: string
	subject: string
	taskName: string | null
	detail: string | null
	age: string
	focused: boolean
	onSelect: () => void
	onHover: () => void
}

export const NotificationRow = memo(function NotificationRow({
	id,
	kind,
	actorName,
	actorAvatarUrl,
	action,
	subject,
	taskName,
	detail,
	age,
	focused,
	onSelect,
	onHover,
}: NotificationRowProps) {
	return (
		<button
			type="button"
			id={id}
			role="option"
			tabIndex={-1}
			aria-selected={focused}
			data-notification-kind={kind}
			onClick={onSelect}
			onMouseMove={onHover}
			className={cn(
				'grid w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-px border-l-2 border-l-transparent px-3 py-2 text-left outline-none',
				'transition-colors hover:bg-accent/5',
				focused && 'border-l-[var(--terminal-accent)] bg-accent/10',
			)}
		>
			<span className="flex h-4 items-center justify-center">
				<NotificationKindIcon kind={kind} />
			</span>
			<span className="flex min-w-0 items-center gap-1.5 text-xs">
				{actorName ? (
					<>
						<Avatar className="size-4 shrink-0 rounded-none">
							<AvatarImage src={actorAvatarUrl ?? ''} alt={actorName} />
							<AvatarFallback className="rounded-none text-[8px]">{getInitials(actorName)}</AvatarFallback>
						</Avatar>
						<span className="truncate">
							<span className="font-semibold">{actorName}</span> {action}
						</span>
					</>
				) : (
					<span className="truncate font-semibold">{action}</span>
				)}
			</span>
			<span className="flex h-4 items-center text-[10px] text-muted-foreground tabular-nums">{age}</span>
			<span className="col-start-2 col-end-4 flex min-w-0 text-[11.5px]">
				<span className="min-w-0 max-w-full flex-none truncate">{subject}</span>
				{taskName ? (
					<span className="min-w-0 flex-1 basis-0 truncate pl-1.5 text-muted-foreground">· {taskName}</span>
				) : null}
			</span>
			{detail ? (
				<span className="col-start-2 col-end-4 truncate text-[11px] text-muted-foreground">{detail}</span>
			) : null}
		</button>
	)
})
