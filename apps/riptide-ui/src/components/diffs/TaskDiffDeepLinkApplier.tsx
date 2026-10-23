import type { TaskDiffDeepLinkTarget } from '@/hooks/diffs/useTaskDiffDeepLinkTarget'
import type { TaskDiffNavigationController } from '@/hooks/diffs/useTaskDiffNavigationController'
import { useMountEffect } from '@/hooks/useMountEffect'

export function TaskDiffDeepLinkPresentationApplier({
	target,
	onApply,
}: {
	readonly target: Exclude<TaskDiffDeepLinkTarget, { status: 'pending' }>
	readonly onApply: (target: Exclude<TaskDiffDeepLinkTarget, { status: 'pending' }>) => void
}) {
	useMountEffect(() => onApply(target))
	return null
}

export function TaskDiffDeepLinkFocusApplier({
	target,
	applyDeepLinkTarget,
}: {
	readonly target: Extract<TaskDiffDeepLinkTarget, { status: 'ready' }>
	readonly applyDeepLinkTarget: TaskDiffNavigationController['applyDeepLinkTarget']
}) {
	useMountEffect(() => applyDeepLinkTarget(target))
	return null
}
