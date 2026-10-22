import { createContext, use } from 'react'

import type { TaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'

export const SessionDiffContext = createContext<TaskDiffReviewModel | null>(null)

export function useOptionalSessionDiff(): TaskDiffReviewModel | null {
	return use(SessionDiffContext)
}
