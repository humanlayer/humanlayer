import { Bell } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'
import { Button } from '../button'

export interface NotificationBellButtonProps extends ComponentProps<typeof Button> {
	count: number
	ringCount: number
}

export function NotificationBellButton({ count, ringCount, className, ...buttonProps }: NotificationBellButtonProps) {
	const label = count === 0 ? 'Notifications' : count === 1 ? '1 notification' : `${count} notifications`
	return (
		<Button
			type="button"
			variant="ghost"
			aria-label={label}
			className={cn(
				'h-5 min-w-5 shrink-0 gap-1 px-1 has-[>svg]:px-1 text-muted-foreground',
				count > 0 && 'text-foreground',
				'data-[state=open]:bg-accent/15 data-[state=open]:text-[var(--terminal-accent)]',
				className,
			)}
			{...buttonProps}
		>
			<Bell key={ringCount} className={cn('size-3', ringCount > 0 && 'animate-bell-ring')} />
			{count > 0 ? (
				<span className="bg-[var(--terminal-accent)] px-1 text-[10px] font-semibold leading-4 text-background tabular-nums">
					{count > 99 ? '99+' : count}
				</span>
			) : null}
		</Button>
	)
}
