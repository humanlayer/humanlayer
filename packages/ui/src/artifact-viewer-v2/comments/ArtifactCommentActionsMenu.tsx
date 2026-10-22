import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '../../components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../../components/dropdown-menu'

export interface ArtifactCommentActionsMenuProps {
	onEdit?: () => void
	onDelete?: (returnFocusElement: HTMLButtonElement | null) => void
}

export function ArtifactCommentActionsMenu({ onEdit, onDelete }: ArtifactCommentActionsMenuProps) {
	const triggerRef = useRef<HTMLButtonElement>(null)
	if (!onEdit && !onDelete) return null

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					ref={triggerRef}
					variant="ghost"
					size="icon"
					className="artifact-viewer-v2-comment-actions-trigger"
					aria-label="Comment actions"
					onClick={(event) => event.stopPropagation()}
					onPointerDown={(event) => event.stopPropagation()}
				>
					<MoreHorizontal aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="artifact-viewer-v2-comment-actions-menu">
				{onEdit ? (
					<DropdownMenuItem onSelect={onEdit}>
						<Pencil aria-hidden="true" />
						Edit
					</DropdownMenuItem>
				) : null}
				{onDelete ? (
					<>
						{onEdit ? <DropdownMenuSeparator /> : null}
						<DropdownMenuItem variant="destructive" onSelect={() => onDelete(triggerRef.current)}>
							<Trash2 aria-hidden="true" />
							Delete
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
