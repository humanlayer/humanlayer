import {
	AlignJustify,
	Bot,
	Brain,
	Circle,
	FileEdit,
	FileText,
	Folder,
	Globe,
	HatGlasses,
	ListChecks,
	ListTodo,
	Search,
	Terminal,
	User,
	Wrench,
	type LucideIcon,
} from 'lucide-react'
import type { FC } from 'react'
import type { ConversationEventType, ConversationRole } from './types'

export type IconSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<IconSize, string> = {
	sm: 'w-3 h-3',
	md: 'w-4 h-4',
	lg: 'w-5 h-5',
}

export interface EventIconProps {
	type: ConversationEventType
	role?: ConversationRole
	toolName?: string
	isCompleted?: boolean
	isThinking?: boolean
	isNamedSubagent?: boolean
	size?: IconSize
	skillColor?: string
}

export const EventIcon: FC<EventIconProps> = ({
	type,
	role,
	toolName,
	isCompleted = true,
	isThinking = false,
	isNamedSubagent = false,
	size = 'md',
	skillColor,
}) => {
	const sizeClass = SIZE_CLASSES[size]

	// Determine icon based on event type and role
	let Icon: LucideIcon = Circle
	let className = sizeClass

	if (type === 'thinking') {
		// Thinking events always show Brain icon
		Icon = Brain
		className = `${sizeClass} text-muted-foreground`
	} else if (type === 'message') {
		if (role === 'user') {
			Icon = User
			className = `${sizeClass} text-[var(--terminal-accent)]`
		} else if (role === 'assistant') {
			Icon = isThinking ? Brain : Bot
			className = isThinking
				? `${sizeClass} text-muted-foreground`
				: `${sizeClass} text-[var(--terminal-accent)]`
		}
	} else if (type === 'tool_call') {
		// Select icon based on tool name (case-insensitive, underscore-insensitive)
		// Claude Code uses PascalCase (Bash), CodeLayer uses lowercase/snake_case (bash, web_search)
		const normalizedToolName = toolName?.toLowerCase().replace(/_/g, '')
		switch (normalizedToolName) {
			case 'bash':
			case 'bashoutput':
				Icon = Terminal
				break
			case 'skill':
				Icon = AlignJustify
				break
			case 'read':
				Icon = FileText
				break
			case 'write':
			case 'edit':
			case 'multiedit':
			case 'notebookedit':
				Icon = FileEdit
				break
			case 'grep':
			case 'glob':
				Icon = Search
				break
			case 'ls':
			case 'list':
				Icon = Folder
				break
			case 'websearch':
			case 'webfetch':
				Icon = Globe
				break
			case 'task':
			case 'agent':
				Icon = isNamedSubagent ? HatGlasses : Wrench
				break
			case 'exitplanmode':
				Icon = ListChecks
				break
			case 'todowrite':
				Icon = ListTodo
				break
			case 'notebookread':
				Icon = FileText
				break
			default:
				Icon = toolName?.startsWith('mcp__') ? Globe : Wrench
		}

		// Completion status affects styling. will-change keeps the infinite pulse on its
		// own compositor layer instead of re-rasterizing the row every frame (WKWebView).
		if (skillColor) {
			className = !isCompleted
				? `${sizeClass} animate-pulse will-change-[opacity]`
				: sizeClass
		} else if (!isCompleted) {
			className = `${sizeClass} text-[var(--terminal-warning)] animate-pulse will-change-[opacity]`
		} else {
			className = `${sizeClass} text-[var(--terminal-accent)]`
		}
	}

	return skillColor
		? <Icon className={className} style={{ color: skillColor }} />
		: <Icon className={className} />
}
