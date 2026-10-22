import {
	Archive,
	AppWindow,
	FileText,
	FolderArchive,
	FolderKanban,
	FolderPlus,
	Layers,
	List,
	Settings,
	type LucideIcon,
} from 'lucide-react'

export type NavigationPageIcon = 'tasks' | 'session' | 'draft' | 'settings' | 'archive' | 'context-shards' | 'page'

export type NavigationPageMetadata = {
	label: string
	icon: NavigationPageIcon
	Icon: LucideIcon
}

export const NAVIGATION_PAGE_METADATA = {
	tasks: { label: 'Tasks', icon: 'tasks', Icon: FolderKanban },
	sessions: { label: 'Sessions', icon: 'session', Icon: List },
	drafts: { label: 'Drafts', icon: 'draft', Icon: FileText },
	contextShards: { label: 'Context Shards', icon: 'context-shards', Icon: Layers },
	newTask: { label: 'New Task', icon: 'draft', Icon: FolderPlus },
	newSession: { label: 'New Session', icon: 'draft', Icon: FileText },
	settings: { label: 'Settings', icon: 'settings', Icon: Settings },
	archivedTasks: { label: 'Archived Tasks', icon: 'archive', Icon: FolderArchive },
	archivedSessions: { label: 'Archived Sessions', icon: 'archive', Icon: Archive },
	page: { label: 'Riptide', icon: 'page', Icon: AppWindow },
} as const
