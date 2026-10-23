import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { Plus } from 'lucide-react'

import { cn } from '@/lib/utils'

import { useHorizontalTabs } from './HorizontalTabsProvider'

export function NewHorizontalTabButton({ className }: { className?: string }) {
	const { canCreateTab, createTasksTab, isAvailable } = useHorizontalTabs()
	if (!isAvailable || !canCreateTab) return null

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={createTasksTab}
					className={cn('size-5 shrink-0', className)}
					aria-label="New workspace tab"
				>
					<Plus className="size-3" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				<p className="flex items-center gap-1">
					New workspace tab <KeyboardShortcut size="xs">⌘T</KeyboardShortcut>
				</p>
			</TooltipContent>
		</Tooltip>
	)
}
