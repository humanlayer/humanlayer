import type { PrStatusStreamStatus } from '@/hooks/session-detail/usePrStatusStream'

/**
 * The four things a section can honestly say about a branch. Every stream status maps onto one, so
 * a section always has something to render: a section the tab listed never resolves to nothing.
 */
export type GitHubPanelState = 'loading' | 'live' | 'recorded' | 'unavailable'

/** `permission_required` is answered by the consent prompt before a panel is built. */
const PANEL_STATES: Record<PrStatusStreamStatus, GitHubPanelState> = {
	idle: 'loading',
	hydrating: 'loading',
	ready: 'live',
	recorded: 'recorded',
	unavailable: 'unavailable',
	permission_required: 'unavailable',
}

export const githubPanelStateOf = (status: PrStatusStreamStatus): GitHubPanelState => PANEL_STATES[status]
