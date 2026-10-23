import { Button } from '@humanlayer/ui/components/button'
import { ChevronDown, ChevronLeft, WifiOff } from 'lucide-react'
import { type FC, type ReactNode, useId, useState } from 'react'

export interface MobileBreadcrumbDetail {
	label: string
	value: string
	mono?: boolean
}

export interface MobileBreadcrumbProps {
	title: string
	isHostOffline?: boolean
	details?: MobileBreadcrumbDetail[]
	onBack?: () => void
	showBackButton?: boolean
	rightElement?: ReactNode
}

/**
 * Sticky mobile header with optional back button (left),
 * compact tappable title (center), optional details panel, and optional right slot.
 */
export const MobileBreadcrumb: FC<MobileBreadcrumbProps> = ({
	title,
	isHostOffline = false,
	details,
	onBack,
	showBackButton = false,
	rightElement,
}) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const detailsId = useId()
	const hasDetails = !!details?.length
	const toggleExpanded = () => {
		setIsExpanded((prev) => !prev)
	}
	const titleContent = (
		<div className="flex max-w-full min-w-0 items-center justify-center gap-1.5">
			<h1 className="min-w-0 truncate text-sm font-medium leading-5">{title}</h1>
			{isHostOffline && (
				<span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium leading-4 text-[var(--terminal-error)]">
					<WifiOff className="h-3 w-3" />
					OFFLINE
				</span>
			)}
			{hasDetails && (
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
						isExpanded ? 'rotate-180' : ''
					}`}
					aria-hidden="true"
				/>
			)}
		</div>
	)

	return (
		<div className="sticky top-0 z-10 flex shrink-0 flex-col border-b bg-background">
			<div className="relative flex min-h-12 items-center justify-center px-2 py-1.5">
				{/* Left: back button (absolute positioned to not affect centering) */}
				{showBackButton && (
					<Button
						variant="ghost"
						size="icon"
						className="absolute left-2 top-1/2 z-10 size-11 -translate-y-1/2"
						onClick={onBack}
						aria-label="Go back"
					>
						<ChevronLeft className="h-5 w-5" />
					</Button>
				)}

				{/* Center: title, critical status, and expand affordance (always centered) */}
				<div className="flex min-w-0 flex-1 items-center justify-center px-12">
					{hasDetails ? (
						<button
							type="button"
							className="flex min-h-11 w-full max-w-full min-w-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-center text-inherit"
							onClick={toggleExpanded}
							aria-expanded={isExpanded}
							aria-controls={detailsId}
						>
							{titleContent}
						</button>
					) : (
						<div className="flex min-h-11 w-full max-w-full min-w-0 items-center justify-center text-center">
							{titleContent}
						</div>
					)}
				</div>

				{/* Right: optional slot (absolute positioned) */}
				{rightElement && (
					<div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center">
						{rightElement}
					</div>
				)}
			</div>

			{hasDetails && isExpanded && (
				<div id={detailsId} className="border-t border-border/60 px-4 py-2">
					{details.map((detail) => (
						<div key={`${detail.label}:${detail.value}`} className="py-1">
							<div className="text-xs leading-4 text-muted-foreground">{detail.label}</div>
							<div
								className={`text-xs leading-4 text-foreground ${
									detail.mono ? 'break-all font-mono' : 'break-words'
								}`}
							>
								{detail.value}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
