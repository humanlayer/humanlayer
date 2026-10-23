import type { DiffReviewPlacement } from '@/hooks/stores/taskDiffReviewStore'

export interface TaskDiffFileNavigator {
	navigateToFile: (fileId: string) => void
}

const navigators = new Map<string, TaskDiffFileNavigator>()

const navigatorKey = (taskId: string, placement: DiffReviewPlacement) => `${taskId}:${placement}`

export function registerTaskDiffFileNavigator(
	taskId: string,
	placement: DiffReviewPlacement,
	navigator: TaskDiffFileNavigator,
): () => void {
	const key = navigatorKey(taskId, placement)
	navigators.set(key, navigator)
	return () => {
		if (navigators.get(key) === navigator) navigators.delete(key)
	}
}

export function navigateMountedTaskDiffFile(taskId: string, placement: DiffReviewPlacement, fileId: string): boolean {
	const navigator = navigators.get(navigatorKey(taskId, placement))
	if (!navigator) return false
	navigator.navigateToFile(fileId)
	return true
}
