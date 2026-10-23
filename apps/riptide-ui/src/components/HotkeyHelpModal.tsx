import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { HotkeyHelpModal as UiHotkeyHelpModal, type HotkeyHelpGroup } from '@humanlayer/ui/components/hotkey-help-modal'
import { HotkeyPlaygroundFrame, PlaygroundControls } from '@humanlayer/ui/components/hotkey-playground'
import { useLocalStorage } from '@uidotdev/usehooks'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useHotkeyHelpStore } from '@/hooks/stores/hotkeyHelpStore'
import { useHotkeyPlayground } from '@/hooks/useHotkeyPlayground'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'
import { buildHotkeyHelpGroups, shortcutPlatform } from '@/hotkeysCatalog'
import { HOTKEYS_PLAYGROUND_COLLAPSED_KEY } from '@/lib/preferences'
import { isDesktop } from '@/lib/utils'

export function HotkeyHelpModal() {
	const isOpen = useHotkeyHelpStore((state) => state.isOpen)
	const setOpen = useHotkeyHelpStore((state) => state.setOpen)
	const [playgroundCollapsed, setPlaygroundCollapsed] = useLocalStorage<boolean>(
		HOTKEYS_PLAYGROUND_COLLAPSED_KEY,
		false,
	)
	// While collapsed the playground releases its keys and its Escape
	// interceptor, so escape closes the dialog directly and j/k etc. do nothing
	// invisible.
	const { state: playgroundState, reset: resetPlayground } = useHotkeyPlayground({
		open: isOpen,
		enabled: !playgroundCollapsed,
	})
	const desktop = isDesktop()
	const keybindingDisplays = useKeybindingDisplays()

	const handleOpenChange = (open: boolean) => {
		setOpen(open)
		// Fresh tutorial on every open, without an effect watching isOpen.
		if (!open) resetPlayground()
	}

	const groups: HotkeyHelpGroup[] = buildHotkeyHelpGroups(keybindingDisplays, { desktop })

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.HOTKEY_HELP}
			isActive={isOpen}
			rootScopeDisabled
			componentName="HotkeyHelpModal"
		>
			<UiHotkeyHelpModal
				open={isOpen}
				onOpenChange={handleOpenChange}
				groups={groups}
				platform={shortcutPlatform}
			>
				<section className="mb-6 hidden md:block">
					<Collapsible open={!playgroundCollapsed} onOpenChange={(open) => setPlaygroundCollapsed(!open)}>
						<div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5">
							<CollapsibleTrigger className="flex items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
								{playgroundCollapsed ? (
									<ChevronRight className="size-3" />
								) : (
									<ChevronDown className="size-3" />
								)}
								<span>Try it</span>
							</CollapsibleTrigger>
						</div>
						<CollapsibleContent>
							<PlaygroundControls state={playgroundState} />
							<HotkeyPlaygroundFrame state={playgroundState} />
						</CollapsibleContent>
					</Collapsible>
				</section>
			</UiHotkeyHelpModal>
		</HotkeyScopeBoundary>
	)
}
