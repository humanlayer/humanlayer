import * as React from 'react'
import { cn } from '@humanlayer/ui/lib/utils'

export interface LoadingStatusBarProps {
	/** Whether the loading bar is visible */
	isLoading?: boolean
	/** Content to display inside the bar (e.g., OmniSpinner) */
	children: React.ReactNode
	/** Additional CSS classes */
	className?: string
}

/**
 * A bottom-positioned status bar container with slide-in/out animation.
 * Typically used with OmniSpinner or similar loading indicators.
 *
 * @example
 * ```tsx
 * <Card className="relative">
 *   <CardContent>...</CardContent>
 *   <LoadingStatusBar isLoading={isProcessing}>
 *     <OmniSpinner />
 *   </LoadingStatusBar>
 * </Card>
 * ```
 */
export function LoadingStatusBar({ isLoading = false, children, className }: LoadingStatusBarProps) {
	if (!isLoading) {
		return null
	}

	return (
		<div
			data-slot="loading-status-bar"
			className={cn(
				'absolute bottom-0 left-0 w-full',
				'px-3 py-1.5',
				'bg-accent/10',
				'font-mono text-xs uppercase tracking-wider text-muted-foreground',
				'transition-[opacity,transform] duration-300 ease-out',
				isLoading ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0',
				className
			)}
		>
			{children}
		</div>
	)
}
