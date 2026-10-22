import { createContext, type ReactNode, use } from 'react'

import { useHorizontalTabs } from './HorizontalTabsProvider'
import { HorizontalTabStrip } from './HorizontalTabStrip'

type HorizontalTabChromeState = {
	isStripVisible: boolean
	ownsHorizontalChrome: boolean
}

const HorizontalTabChromeContext = createContext<HorizontalTabChromeState>({
	isStripVisible: false,
	ownsHorizontalChrome: false,
})

export function useHorizontalTabChromeState(): HorizontalTabChromeState {
	return use(HorizontalTabChromeContext)
}

export function HorizontalTabChrome({ children }: { children: ReactNode }) {
	const { isAvailable, tabs } = useHorizontalTabs()
	const isStripVisible = isAvailable && tabs.length > 1
	const state = { isStripVisible, ownsHorizontalChrome: isStripVisible }
	return <HorizontalTabChromeContext.Provider value={state}>{children}</HorizontalTabChromeContext.Provider>
}

export function HorizontalTabChromeStrip() {
	const { isStripVisible } = useHorizontalTabChromeState()
	return isStripVisible ? <HorizontalTabStrip /> : null
}
