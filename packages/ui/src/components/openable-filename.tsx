import type { FC } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@humanlayer/ui/components/button'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { TooltipContent } from '@humanlayer/ui/components/tooltip'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'

export interface OpenableFilenameProps {
	path: string
	displayPath?: string
	onOpen?: (path: string) => void
	shortcutKey?: string
	className?: string
}

export const OpenableFilename: FC<OpenableFilenameProps> = ({
	path,
	displayPath,
	onOpen,
	shortcutKey = 'O',
	className = 'text-sm',
}) => {
	return (
		<span className="inline-flex items-center gap-1">
			<code className={`font-mono text-muted-foreground ${className}`}>
				{displayPath || path}
			</code>
			{onOpen && (
				<TooltipPrimitive.Provider delayDuration={400}>
					<TooltipPrimitive.Root>
						<TooltipPrimitive.Trigger asChild>
							<Button
								onClick={(e) => {
									e.stopPropagation()
									onOpen(path)
								}}
								variant="ghost"
								size="icon"
								className="w-5 h-5 hover:bg-accent/10"
							>
								<ExternalLink className="w-3 h-3" />
							</Button>
						</TooltipPrimitive.Trigger>
						<TooltipContent side="bottom">
							<p className="flex items-center gap-1">
								Open in editor <KeyboardShortcut>{shortcutKey}</KeyboardShortcut>
							</p>
						</TooltipContent>
					</TooltipPrimitive.Root>
				</TooltipPrimitive.Provider>
			)}
		</span>
	)
}