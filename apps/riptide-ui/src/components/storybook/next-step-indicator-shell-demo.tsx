import { Card } from '@humanlayer/ui/components/card'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

import { NEXT_STEP_INDICATOR_CLEARANCE_PX, NextStepIndicator } from '@/components/NextStepIndicator'
import { useNextStepIndicatorVisible } from '@/hooks/useNextStepIndicatorVisible'

export interface NextStepIndicatorShellDemoProps {
	/** IDs of the fixture rows that are "next-step events" — the last one drives indicator visibility. */
	nextStepEventIds: string[]
	/** Mirrors the dismissed-id selector behavior. */
	dismissedEventId: string | null
	isReadyForInput: boolean
	/** Number of fixture rows to render. */
	rowCount?: number
}

/**
 * ShellDemo: hosts the real <NextStepIndicator /> over a real useVirtualizer
 * with paddingEnd driven by the same visibility hook used in production. Lets
 * a reviewer confirm that the bottom-most fixture row is fully readable above
 * the floating bar when the indicator is visible.
 */
export function NextStepIndicatorShellDemo({
	nextStepEventIds,
	dismissedEventId,
	isReadyForInput,
	rowCount = 40,
}: NextStepIndicatorShellDemoProps) {
	const parentRef = useRef<HTMLDivElement | null>(null)
	const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null)

	const { visible } = useNextStepIndicatorVisible({
		nextStepEventIds,
		dismissedEventId,
		isReadyForInput,
		virtualizerRef,
		parentRef,
	})

	const virtualizer = useVirtualizer({
		count: rowCount,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 100,
		paddingEnd: visible ? NEXT_STEP_INDICATOR_CLEARANCE_PX : 0,
		getItemKey: (index) => `event-${index}`,
		overscan: 5,
	})
	virtualizerRef.current = virtualizer

	return (
		<Card className="relative h-[600px] flex flex-col gap-0! pb-2">
			<div ref={parentRef} className="overflow-y-auto flex-1 px-3">
				<div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
					{virtualizer.getVirtualItems().map((row) => (
						<div
							key={row.key}
							ref={virtualizer.measureElement}
							data-index={row.index}
							style={{
								position: 'absolute',
								top: 0,
								left: 0,
								width: '100%',
								transform: `translateY(${row.start}px)`,
							}}
						>
							<div className="p-4 border-b border-border/40 font-mono text-sm">
								<div className="text-xs text-muted-foreground uppercase">event-{row.index}</div>
								<div>
									Fixture conversation row {row.index + 1} of {rowCount}. The bottom-most row must
									remain fully readable when the floating NextStepIndicator is visible.
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
			<NextStepIndicator
				nextStepEventIds={nextStepEventIds}
				dismissedEventId={dismissedEventId}
				isRunning={false}
				isReadyForInput={isReadyForInput}
				onScrollToNextStep={() => {}}
				virtualizerRef={virtualizerRef}
				parentRef={parentRef}
			/>
		</Card>
	)
}
