import { Tabs, TabsList, TabsTrigger } from '../tabs'

export interface ReviewScopeControlProps {
	hideReviewed: boolean
	totalCount: number
	toReviewCount: number
	onHideReviewedChange: (hideReviewed: boolean) => void
	className?: string
}

export function ReviewScopeControl({
	hideReviewed,
	totalCount,
	toReviewCount,
	onHideReviewedChange,
	className,
}: ReviewScopeControlProps) {
	return (
		<Tabs
			value={hideReviewed ? 'to-review' : 'all'}
			onValueChange={(value) => onHideReviewedChange(value === 'to-review')}
			className={className}
		>
			<TabsList
				variant="underline"
				aria-label="Review scope"
				className="relative gap-1 after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-0.5 after:bg-border/60 after:content-['']"
			>
				<TabsTrigger value="all" className="relative z-10 flex-none px-2 text-xs">
					All ({totalCount})
				</TabsTrigger>
				<TabsTrigger value="to-review" className="relative z-10 flex-none px-2 text-xs">
					To review ({toReviewCount})
				</TabsTrigger>
			</TabsList>
		</Tabs>
	)
}
