import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Sparkles, X } from 'lucide-react'

import { isApplePlatform } from '@/hooks/hotkeys/platform-hotkeys'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useToggleMinimalistLayout } from '@/hooks/use-minimalist-layout'

/** Invites you to try the minimalist interface beta from the standard one, until you dismiss it. */
export function MinimalistTryBanner() {
	const dismissed = useSettingsStore((state) => state.minimalistBannersDismissed.tryIt)
	const dismiss = useSettingsStore((state) => state.dismissMinimalistBanner)
	const toggle = useToggleMinimalistLayout()
	if (dismissed) return null
	return (
		<div role="status" className="flex items-center gap-2 border-b bg-muted/50 px-4 py-1.5 text-sm">
			<Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
			<span className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1">
				<span>Try the new minimalist UI beta.</span>
				<Button size="xs" variant="secondary" onClick={toggle}>
					Try it now
				</Button>
				<span className="text-muted-foreground">or toggle with</span>
				<KeyboardShortcut size="xs">{isApplePlatform() ? '⌘+K' : 'Ctrl+K'}</KeyboardShortcut>
			</span>
			<Button
				size="icon"
				variant="ghost"
				title="Dismiss"
				aria-label="Dismiss minimalist UI banner"
				className="size-6"
				onClick={() => dismiss('tryIt')}
			>
				<X className="h-3.5 w-3.5" />
			</Button>
		</div>
	)
}
