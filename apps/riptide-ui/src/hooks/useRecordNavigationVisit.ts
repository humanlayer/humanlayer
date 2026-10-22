import { type NavigationHistoryEntryType, useNavigationHistoryStore } from '@/hooks/stores/navigationHistoryStore'
import { useMountEffect } from '@/hooks/useMountEffect'

export function useRecordNavigationVisit(id: string, type: NavigationHistoryEntryType) {
	useMountEffect(() => {
		useNavigationHistoryStore.getState().recordVisit(id, type)
	})
}
