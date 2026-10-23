import { useDraftsStore } from '@/hooks/stores/draftsStore'
import { getTextFromContent } from '@/utils/tiptap-content'

/** Where the new-task page keeps its text: one for a new task, one per task for a new session in it. */
export const newTaskDraftKey = (taskId?: string) => (taskId ? `new-session:${taskId}` : 'new-task')

/**
 * Composer text kept in the drafts store the standard and mobile composers use, keyed by session id
 * (or `newTaskDraftKey`), so a half-written message survives switching tasks, a reload, or switching
 * interfaces. Works like useState; an empty string removes the draft.
 */
export function useDraft(key: string) {
	const content = useDraftsStore((state) => state.drafts[key] ?? null)
	const setDraft = (next: string | ((current: string) => string)) => {
		const { drafts, setDraft: save, clearDraft } = useDraftsStore.getState()
		const text = typeof next === 'function' ? next(getTextFromContent(drafts[key] ?? null)) : next
		if (text) save(key, text)
		else clearDraft(key)
	}
	return [getTextFromContent(content), setDraft] as const
}

/** Whether any of these drafts holds text, for a marker on a task someone started writing to. */
export function useHasDraft(keys: readonly string[]) {
	return useDraftsStore((state) => keys.some((key) => getTextFromContent(state.drafts[key] ?? null).trim() !== ''))
}
