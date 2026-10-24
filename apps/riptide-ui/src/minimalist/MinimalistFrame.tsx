import type { ReactNode } from 'react'
import { useState } from 'react'

import { BetaBanner } from './components/BetaBanner'
import { SonnerToastBridge } from './components/SonnerToastBridge'
import { TabShortcuts } from './components/TabShortcuts'
import { TabStrip } from './components/TabStrip'
import { WiredUpdateNotices } from './components/UpdateNotices'
import { useMinimalistDark } from './lib/color-scheme'
import { storedWidthStyle } from './lib/panel-widths'
import { MinimalistPortalContext } from './lib/portal'
import { UiProvider } from './lib/ui-state'

import './styles.css'

function Frame({ children }: { children: ReactNode }) {
	const dark = useMinimalistDark()
	const [portal, setPortal] = useState<HTMLDivElement | null>(null)
	// Read once: after that, resize handles set these variables on this element directly.
	const [widths] = useState(storedWidthStyle)
	return (
		<div className={`minimalist-ui${dark ? ' dark' : ''}`} style={widths} data-testid="minimalist-interface">
			<MinimalistPortalContext.Provider value={portal}>
				<div className="minimalist-frame">
					<TabShortcuts />
					<TabStrip />
					<BetaBanner />
					<div className="minimalist-content">{children}</div>
				</div>
				<WiredUpdateNotices />
			</MinimalistPortalContext.Provider>
			<SonnerToastBridge />
			<div ref={setPortal} />
		</div>
	)
}

export default function MinimalistFrame({ children }: { children: ReactNode }) {
	return (
		<UiProvider>
			<Frame>{children}</Frame>
		</UiProvider>
	)
}
