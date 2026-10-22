import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { cn } from '@humanlayer/ui/lib/utils'
import { KeyboardShortcut } from './keyboard-shortcut'
import { PhaseTipContent, PhaseTipRoot } from './phase-tip-banner'
import { SessionLabelBadge } from './session-label-badge'

export interface PhaseTipModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	phase: string
	onClose: () => void
	onDontShowPhase: () => void
	onNeverShowTips: () => void
	className?: string
}

export function PhaseTipModal({
	open,
	onOpenChange,
	phase,
	onClose,
	onDontShowPhase,
	onNeverShowTips,
	className,
}: PhaseTipModalProps) {
	return (
		<PhaseTipRoot phase={phase}>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent
					className={cn('sm:max-w-2xl text-sm', className)}
					onPointerDownOutside={(e) => e.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-sm font-medium">
							Workflow Phase:
							<SessionLabelBadge
								label={{ name: `rpi:${phase}`, title: phase }}
								className="w-auto text-xs"
							/>
						</DialogTitle>
					</DialogHeader>
					<div className="max-h-[60vh] overflow-y-auto">
						<PhaseTipContent phase={phase} />
					</div>
					<div className="flex justify-center mb-2">
						<div className="flex flex-col items-center gap-1 border border-dashed border-border rounded-md p-3 w-fit">
							<div className="bg-muted text-muted-foreground inline-flex h-8 w-fit items-center justify-center rounded-lg p-[3px]">
								{['Artifacts', 'Minimap', 'Tips', 'Summary'].map((tab) => (
									<span
										key={tab}
										className={cn(
											'uppercase tracking-wider inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md px-1.5 text-xs font-medium',
											tab === 'Tips'
												? 'bg-background text-foreground shadow-sm'
												: 'border border-transparent text-muted-foreground',
										)}
									>
										{tab}
									</span>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								You can view these tips in the right sidebar
							</p>
						</div>
					</div>
					<DialogFooter className="flex justify-end gap-2 sm:justify-end">
						<Button variant="secondary" size="sm" onClick={onDontShowPhase}>
							Don't show this tip again
						</Button>
						<Button variant="secondary" size="sm" onClick={onNeverShowTips}>
							Never show tips
						</Button>
						<Button variant="default" size="sm" onClick={onClose}>
							Got it
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
									? '⌘+Enter'
									: 'Ctrl+Enter'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</PhaseTipRoot>
	)
}
