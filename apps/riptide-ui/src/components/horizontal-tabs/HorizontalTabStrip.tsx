import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import {
	renderSessionStatusIndicator,
	renderTaskStatusIndicator,
	UnreadBullet,
} from '@humanlayer/ui/components/sidebar/status-indicators'
import { Tabs, TabsList, TabsTrigger } from '@humanlayer/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { X } from 'lucide-react'

import { WiredNotificationBell } from '@/components/notifications/WiredNotificationBell'
import { NAVIGATION_PAGE_METADATA } from '@/lib/navigation-page-metadata'
import { hasMacWindowControls } from '@/lib/tauri-chrome'
import { cn, isTauri } from '@/lib/utils'

import { type HorizontalTabIndicator, type HorizontalTabPresentation } from './horizontalTabPresentation'
import { useHorizontalTabs } from './HorizontalTabsProvider'
import { NewHorizontalTabButton } from './NewHorizontalTabButton'
import { useHorizontalTabPresentation } from './useHorizontalTabPresentation'
import { useTabWindowDrag } from './useTabWindowDrag'

function HorizontalTabIndicator({ indicator }: { indicator: HorizontalTabIndicator }) {
	if (indicator.kind === 'task-status')
		return (
			<span className="flex size-2.5 shrink-0 items-center justify-center">
				{renderTaskStatusIndicator(indicator.status)}
			</span>
		)
	if (indicator.kind === 'session-status')
		return (
			<span className="flex size-2.5 shrink-0 items-center justify-center">
				{renderSessionStatusIndicator(indicator.status)}
			</span>
		)
	if (indicator.kind === 'unread')
		return (
			<span className="flex size-2.5 shrink-0 items-center justify-center">
				<UnreadBullet />
			</span>
		)
	return null
}

function HorizontalTabIcon({ icon }: { icon: HorizontalTabPresentation['icon'] }) {
	const metadata = Object.values(NAVIGATION_PAGE_METADATA).find((candidate) => candidate.icon === icon)
	const Icon = metadata?.Icon ?? NAVIGATION_PAGE_METADATA.page.Icon
	return <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
}

function HorizontalTabStripItem({
	tab,
	index,
	isSelected,
}: {
	tab: { id: string; href: string }
	index: number
	isSelected: boolean
}) {
	const { closeTab } = useHorizontalTabs()
	const presentation = useHorizontalTabPresentation(tab.href)
	const onPointerDown = useTabWindowDrag()

	return (
		<div
			className={cn(
				'group relative flex h-full min-w-0 flex-1 items-stretch hover:bg-sidebar-accent/40',
				isSelected && 'bg-sidebar-accent/70',
			)}
		>
			<TabsTrigger
				value={tab.id}
				// Tauri stops at interactive elements unless the trigger itself opts in.
				data-tauri-drag-region="deep"
				onPointerDown={onPointerDown}
				onMouseDown={(event) => {
					if (!isTauri() || event.button !== 0 || event.ctrlKey) return
					const trigger = event.currentTarget
					// Tauri cancels the browser's default focus. Restore it after Radix's
					// mousedown selection commits, so keyboard tab navigation still works.
					queueMicrotask(() => {
						if (trigger.isConnected) trigger.focus({ preventScroll: true })
					})
				}}
				className="z-10 min-w-0 flex-1 select-none justify-start gap-1 border-b-0 px-1.5 text-left text-[10px] tracking-normal normal-case data-[state=active]:border-b-0 data-[state=active]:bg-transparent"
				aria-label={`${presentation.label} workspace tab`}
			>
				<HorizontalTabIndicator indicator={presentation.indicator} />
				<HorizontalTabIcon icon={presentation.icon} />
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="min-w-0 flex-1 truncate">{presentation.label}</span>
					</TooltipTrigger>
					<TooltipContent>{presentation.label}</TooltipContent>
				</Tooltip>
				<KeyboardShortcut size="xs" className="shrink-0 text-[9px]!">
					⌘{index + 1}
				</KeyboardShortcut>
			</TabsTrigger>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				onClick={() => closeTab(tab.id)}
				className="z-10 mr-0.5 size-5 shrink-0 self-center border-transparent p-0 text-muted-foreground/70 hover:bg-transparent hover:border-transparent hover:text-foreground"
				aria-label={`Close ${presentation.label}`}
				title={`Close ${presentation.label}`}
			>
				<X className="size-3" />
			</Button>
			{isSelected ? (
				<span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-0.5 bg-primary" />
			) : null}
		</div>
	)
}

export function HorizontalTabStrip() {
	const { selectedTabId, selectTab, tabs } = useHorizontalTabs()
	if (tabs.length <= 1 || !selectedTabId) return null

	return (
		<Tabs value={selectedTabId} onValueChange={selectTab} className="h-8 shrink-0 gap-0" data-tauri-drag-region>
			<TabsList
				variant="underline"
				aria-label="Open workspaces"
				data-tauri-drag-region="deep"
				className={cn(
					'h-8 w-full min-w-0 gap-0 overflow-hidden border-b border-sidebar-border bg-sidebar',
					hasMacWindowControls() && 'pl-19',
				)}
			>
				{tabs.map((tab, index) => (
					<HorizontalTabStripItem
						key={tab.id}
						tab={tab}
						index={index}
						isSelected={tab.id === selectedTabId}
					/>
				))}
				<NewHorizontalTabButton className="mx-1 self-center" />
				<WiredNotificationBell placement="tab-strip" className="mr-2 self-center" />
			</TabsList>
		</Tabs>
	)
}
