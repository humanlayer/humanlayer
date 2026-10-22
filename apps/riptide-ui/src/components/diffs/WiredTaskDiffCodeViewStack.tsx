import { CodeViewStack, type CodeViewStackProps } from '@humanlayer/ui/components/diff-review/code-view-stack'

import { useTaskDiffFocusStore } from '@/hooks/stores/taskDiffFocusStore'

type WiredTaskDiffCodeViewStackProps = Omit<
	CodeViewStackProps,
	'focusedTarget' | 'keyboardRange' | 'showFocusHints'
> & { taskId: string }

/** Keeps Pierre's controlled selection reactive without subscribing the review workspace owner. */
export function WiredTaskDiffCodeViewStack(props: WiredTaskDiffCodeViewStackProps) {
	const focusedTarget = useTaskDiffFocusStore((state) => state.byTask[props.taskId]?.target ?? null)
	const keyboardRange = useTaskDiffFocusStore((state) => state.byTask[props.taskId]?.range ?? null)
	const showFocusHints = useTaskDiffFocusStore((state) => {
		const entry = state.byTask[props.taskId]
		return entry?.source === 'keyboard' && entry.showHints === true
	})

	return (
		<CodeViewStack
			{...props}
			focusedTarget={focusedTarget}
			keyboardRange={keyboardRange}
			showFocusHints={showFocusHints}
		/>
	)
}
