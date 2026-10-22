import type { LucideIcon } from 'lucide-react'
import type { FC } from 'react'

import { cn } from '@/lib/utils'

export interface PillStyle {
	readonly icon: LucideIcon
	readonly label: string
	readonly className: string
}

/** Square, bordered, uppercase: one icon and one word, in the colour of what it says. */
export const StatusPill: FC<PillStyle & { 'data-testid'?: string }> = ({
	icon: Icon,
	label,
	className,
	'data-testid': testId,
}) => (
	<span
		className={cn(
			'inline-flex shrink-0 items-center gap-1 rounded-none border px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide',
			className,
		)}
		data-testid={testId}
	>
		<Icon aria-hidden className="h-3 w-3 shrink-0" />
		{label}
	</span>
)
