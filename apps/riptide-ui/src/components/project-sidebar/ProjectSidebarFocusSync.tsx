import type { SidebarItem } from '@humanlayer/ui/components/sidebar/types'

import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMountEffect } from '@/hooks/useMountEffect'

import { visibleSidebarFocus } from './derive-project-sidebar'

/** Keyed by the rendered IDs: handles route-seeded idle sessions, caps, archives and collapsed groups. */
export function ProjectSidebarFocusSync({ items }: { items: SidebarItem[] }) {
	useMountEffect(() => {
		const reconcile = () => {
			const state = useFocusStore.getState()
			const current = state.focusedSidebarItem
			const next = visibleSidebarFocus(current, items)
			if (current?.id !== next?.id || current?.type !== next?.type) state.setFocusedSidebarItem(next)
		}
		reconcile()
		return useFocusStore.subscribe(reconcile)
	})
	return null
}
