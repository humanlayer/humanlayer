import { useRouter } from '@tanstack/react-router'

import { useHorizontalTabs } from '@/components/horizontal-tabs/HorizontalTabsProvider'
import { MAX_HORIZONTAL_TABS, useHorizontalTabsStore } from '@/hooks/stores/horizontalTabsStore'
import { useUi } from '@/minimalist/lib/ui-state'

/** Keep the desktop tab history, but open the minimalist new-task page rather than the main task board. */
export function useMinimalistTabs() {
	const tabs = useHorizontalTabs()
	const router = useRouter()
	const { showToast } = useUi()
	return {
		...tabs,
		createTab: () => {
			if (!tabs.isAvailable) return
			const tab = useHorizontalTabsStore.getState().appendAndSelectTab('/', router.state.location.href)
			if (tab) void router.navigate({ href: tab.href, replace: true })
			else showToast(`You can open up to ${MAX_HORIZONTAL_TABS} tabs. Close a tab to open another.`)
		},
	}
}
