import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface DismissableToastTitleProps {
	title: ReactNode
	description?: ReactNode
	onDismiss: () => void
	titleClassName?: string
}

export function DismissableToastTitle({ title, description, onDismiss, titleClassName }: DismissableToastTitleProps) {
	return (
		<div className="flex flex-col gap-0.5 relative pr-6">
			<button
				type="button"
				aria-label="Dismiss"
				onClick={onDismiss}
				className="absolute -top-1 -right-1 p-1 text-muted-foreground hover:text-foreground hover:border hover:border-border cursor-pointer transition-colors"
			>
				<X className="h-3 w-3" />
			</button>
			<span className={titleClassName ?? 'font-bold'}>{title}</span>
			{description && <span className="text-xs text-muted-foreground">{description}</span>}
		</div>
	)
}
