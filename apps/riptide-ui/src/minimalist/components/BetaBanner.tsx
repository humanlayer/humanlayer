import { X } from 'lucide-react'

import { isApplePlatform } from '@/hooks/hotkeys/platform-hotkeys'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useToggleMinimalistLayout } from '@/hooks/use-minimalist-layout'

/** Tells you this interface is a beta and how to get the standard one back, until you dismiss it. */
export function BetaBanner() {
	const dismissed = useSettingsStore((state) => state.minimalistBannersDismissed.beta)
	const dismiss = useSettingsStore((state) => state.dismissMinimalistBanner)
	const toggle = useToggleMinimalistLayout()
	if (dismissed) return null
	return (
		<div className="beta-banner" role="status">
			<span>
				This is the beta of the new minimalist UI.{' '}
				<button type="button" className="beta-banner-link" onClick={toggle}>
					Switch back to the old UI
				</button>{' '}
				or toggle with <span className="kbd">{isApplePlatform() ? '⌘+K' : 'Ctrl+K'}</span>
			</span>
			<button
				type="button"
				className="iconbtn"
				title="Dismiss"
				aria-label="Dismiss beta banner"
				onClick={() => dismiss('beta')}
			>
				<X className="i sm" strokeWidth={1.6} />
			</button>
		</div>
	)
}
