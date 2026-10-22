import { Link } from '@tanstack/react-router'
import { Bell, FileText, GitPullRequest, Kanban, PanelLeft, Search, SquarePen } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { useSyncInternal } from '@/components/providers/SyncProvider'
import { AccountMenu } from '@/minimalist/components/AccountMenu'
import { AttentionList } from '@/minimalist/components/AttentionList'
import { ProjectList } from '@/minimalist/components/ProjectList'
import { ResizeHandle } from '@/minimalist/components/ResizeHandle'
import { UpdateLine } from '@/minimalist/components/UpdateNotices'
import { useMinimalistInbox } from '@/minimalist/lib/inbox'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { useUi } from '@/minimalist/lib/ui-state'

/** The "What needs you" switch counts the same shared rows as the list. */
function AttentionButton({ count, pressed, onToggle }: { count: number; pressed: boolean; onToggle: () => void }) {
	const label = count > 0 ? `What needs you: ${count}` : 'What needs you'
	return (
		<button
			type="button"
			className="attention"
			title={label}
			aria-label={label}
			aria-pressed={pressed}
			onClick={onToggle}
		>
			<Bell className="i" strokeWidth={1.6} />
			{count > 0 ? <span className="dot" aria-hidden="true" /> : null}
		</button>
	)
}

export function Sidebar() {
	const { attentionView, toggleAttentionView, setSearchOpen, toggleSidebar, closeSidebarOnNarrow } = useUi()
	const inbox = useMinimalistInbox()
	return (
		<aside className="sidebar" aria-label="Projects and tasks">
			<div className="brand">
				HumanLayer
				<span className="sp" />
				<span className="ic">
					<button type="button" title="Search" aria-label="Search" onClick={() => setSearchOpen(true)}>
						<Search className="i" strokeWidth={1.6} />
					</button>
					<AttentionButton count={inbox.rows.length} pressed={attentionView} onToggle={toggleAttentionView} />
					<button type="button" title="Close sidebar" aria-label="Close sidebar" onClick={toggleSidebar}>
						<PanelLeft className="i" strokeWidth={1.6} />
					</button>
				</span>
			</div>
			<nav className="nav" aria-label="Main navigation">
				<Link
					to="/"
					onClick={closeSidebarOnNarrow}
					activeOptions={{ exact: true }}
					activeProps={{ className: 'sel' }}
				>
					<SquarePen className="i" strokeWidth={1.6} />
					New task
					<span className="kbd hover-kbd">{shortcutHint('new-task')}</span>
				</Link>
				<Link to="/board" onClick={closeSidebarOnNarrow} activeProps={{ className: 'sel' }}>
					<Kanban className="i" strokeWidth={1.6} />
					Board
				</Link>
				<Link to="/pull-requests" onClick={closeSidebarOnNarrow} activeProps={{ className: 'sel' }}>
					<GitPullRequest className="i" strokeWidth={1.6} />
					Pull requests
				</Link>
				<Link to="/artifacts" onClick={closeSidebarOnNarrow} activeProps={{ className: 'sel' }}>
					<FileText className="i" strokeWidth={1.6} />
					Artifacts
				</Link>
			</nav>
			<div className="list">{attentionView ? <AttentionList {...inbox} /> : <ProjectList />}</div>
			<SyncLine />
			<UpdateLine />
			<AccountMenu />
			<ResizeHandle pane="sidebar" edge="right" />
		</aside>
	)
}

/** A quiet footer line instead of a banner; it only appears while sync is down. */
function SyncLine() {
	const { tracker } = useSyncInternal()
	const offline = useSyncExternalStore(
		(callback) => tracker.onOfflineChange(() => callback()),
		() => tracker.getOfflineCollections(),
	)
	if (offline.length === 0) return null
	return (
		<Link to="/settings/sync" className="sync-line" title="Sync is down, so what you see may be out of date">
			<span className="spin" />
			Reconnecting…
		</Link>
	)
}
