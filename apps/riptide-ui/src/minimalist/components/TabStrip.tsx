import { Plus, X } from 'lucide-react'

import { useHorizontalTabPresentation } from '@/components/horizontal-tabs/useHorizontalTabPresentation'
import { useTabWindowDrag } from '@/components/horizontal-tabs/useTabWindowDrag'
import { isApplePlatform } from '@/hooks/hotkeys/platform-hotkeys'
import { hasMacWindowControls } from '@/lib/tauri-chrome'
import { isTauri } from '@/lib/utils'
import { selectWithArrows } from '@/minimalist/lib/roving'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { useMinimalistTabs } from '@/minimalist/lib/tabs'

function tabPageLabel(href: string, fallback: string): string {
	const pathname = new URL(href, 'https://humanlayer.local').pathname
	if (pathname === '/') return 'New task'
	if (pathname === '/artifacts') return 'Artifacts'
	if (pathname === '/pull-requests') return 'Pull requests'
	return fallback
}

function TabItem({ id, href, index, selected }: { id: string; href: string; index: number; selected: boolean }) {
	const { selectTab, closeTab, tabs } = useMinimalistTabs()
	const presentation = useHorizontalTabPresentation(href)
	const label = tabPageLabel(href, presentation.label)
	const onPointerDown = useTabWindowDrag()
	return (
		<div className={`top-tab${selected ? ' sel' : ''}`}>
			<button
				type="button"
				role="tab"
				aria-selected={selected}
				aria-label={label}
				tabIndex={selected ? 0 : -1}
				data-tauri-drag-region="deep"
				onPointerDown={onPointerDown}
				onMouseDown={(event) => {
					if (!isTauri() || event.button !== 0 || event.ctrlKey) return
					// Native dragging can consume the click, so select before it starts.
					selectTab(id)
					const button = event.currentTarget
					queueMicrotask(() => {
						if (button.isConnected) button.focus({ preventScroll: true })
					})
				}}
				onClick={() => selectTab(id)}
				title={label}
			>
				<span className="ell">{label}</span>
				<span className="kbd">
					{isApplePlatform() ? '⌘' : 'Ctrl+'}
					{index + 1}
				</span>
			</button>
			<button
				type="button"
				className="iconbtn top-tab-close"
				aria-label={`Close ${label} tab`}
				title="Close tab"
				disabled={tabs.length <= 1}
				onClick={() => closeTab(id)}
			>
				<X className="i xs" aria-hidden="true" />
			</button>
		</div>
	)
}

/** Separate minimalist chrome over the shared desktop tab state. Browser tabs remain browser-owned. */
export function TabStrip() {
	const { isAvailable, tabs, selectedTabId, canCreateTab, createTab } = useMinimalistTabs()
	if (!isAvailable) return null
	return (
		<div className={`top-tabs${hasMacWindowControls() ? ' window-controls' : ''}`} data-tauri-drag-region>
			<div role="tablist" aria-label="Open tabs" className="top-tab-list" onKeyDown={selectWithArrows}>
				{tabs.map((tab, index) => (
					<TabItem key={tab.id} {...tab} index={index} selected={tab.id === selectedTabId} />
				))}
			</div>
			<button
				type="button"
				className="iconbtn"
				aria-label="Create tab"
				title={`Create tab (${isApplePlatform() ? shortcutHint('new-tab') : 'Ctrl+T'})`}
				disabled={!canCreateTab}
				onClick={createTab}
			>
				<Plus className="i" aria-hidden="true" />
			</button>
		</div>
	)
}
