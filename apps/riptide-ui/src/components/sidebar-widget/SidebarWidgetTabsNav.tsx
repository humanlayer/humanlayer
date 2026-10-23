import { TabsList, TabsTrigger } from '@humanlayer/ui/components/tabs'

import { FailingCheckCountBadge } from '@/components/github/FailingCheckCountBadge'

/**
 * What a tab trigger says about the tab while it is shut: a failing-check count, a warning dot
 * (something needs GitHub), or an accent dot (the pull request the tab now shows is new).
 */
export type SidebarNavAttention = { kind: 'failing'; count: number } | { kind: 'warning' } | { kind: 'accent' }

export type SidebarNavItem<TValue extends string> = {
	value: TValue
	label: string
	show?: boolean
	attention?: SidebarNavAttention
}

export interface SidebarWidgetTabsNavProps<TValue extends string> {
	items: SidebarNavItem<TValue>[]
}

const DOT_LABELS = { warning: 'needs GitHub', accent: 'pull request opened' } as const

const AttentionMark = ({ attention }: { attention: SidebarNavAttention | undefined }) => {
	if (!attention) return null
	if (attention.kind === 'failing') return <FailingCheckCountBadge count={attention.count} />
	return (
		<span
			role="img"
			aria-label={DOT_LABELS[attention.kind]}
			data-testid={`sidebar-tab-dot-${attention.kind}`}
			className={
				attention.kind === 'warning'
					? 'size-1.5 shrink-0 rounded-full bg-[var(--terminal-warning)]'
					: 'size-1.5 shrink-0 rounded-full bg-accent'
			}
		/>
	)
}

export function SidebarWidgetTabsNav<TValue extends string>({ items }: SidebarWidgetTabsNavProps<TValue>) {
	const visibleItems = items.filter((item) => item.show ?? true)

	return (
		// Group-wide dark underbar (as on the Everything/Mine toggle); the active
		// trigger's accent bar from the underline variant sits on top of it.
		<TabsList
			variant="underline"
			className="relative h-auto min-h-9 max-w-full flex-wrap justify-start gap-1 after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-0.5 after:bg-border/60 after:content-['']"
		>
			{visibleItems.map((item) => (
				<TabsTrigger
					key={item.value}
					value={item.value}
					className="relative z-10 h-9 flex-none gap-1 px-2 text-xs"
				>
					{item.label}
					<AttentionMark attention={item.attention} />
				</TabsTrigger>
			))}
		</TabsList>
	)
}
