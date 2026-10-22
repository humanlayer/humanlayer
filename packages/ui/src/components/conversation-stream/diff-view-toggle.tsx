import type { FC } from 'react'
import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { SquareSplitHorizontal, SquareSplitVertical } from 'lucide-react'

export interface DiffViewToggleProps {
	isSplitView: boolean
	onToggle: (ev: React.MouseEvent<HTMLButtonElement>) => void
	/**
	 * Set when the other view can't be used right now; the toggle stays focusable and shows this as
	 * its name and tooltip, but does nothing.
	 */
	unavailableTitle?: string
}

export const DiffViewToggle: FC<DiffViewToggleProps> = ({ isSplitView, onToggle, unavailableTitle }) => {
	return (
		<Button
			variant="ghost"
			size="sm"
			// aria-disabled rather than disabled, which drops pointer events and so the tooltip.
			aria-disabled={unavailableTitle ? true : undefined}
			onClick={unavailableTitle ? undefined : onToggle}
			className={cn('h-8 w-8 p-0', unavailableTitle ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
			title={unavailableTitle ?? (isSplitView ? 'Switch to inline view' : 'Switch to split view')}
		>
			{isSplitView ? <SquareSplitVertical className="h-4 w-4" /> : <SquareSplitHorizontal className="h-4 w-4" />}
		</Button>
	)
}
