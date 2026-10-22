import {
	Bot,
	File,
	Globe,
	List,
	ListTodo,
	MessageCircle,
	Plug,
	Search,
	SquareTerminal,
	Wrench,
	type LucideIcon,
} from 'lucide-react'

import type { StepIcon } from '@/minimalist/lib/tools'

const STEP_ICONS: Record<StepIcon, LucideIcon> = {
	file: File,
	terminal: SquareTerminal,
	search: Search,
	bot: Bot,
	globe: Globe,
	todo: ListTodo,
	plug: Plug,
	list: List,
	message: MessageCircle,
	tool: Wrench,
}

export function StepGlyph({ icon }: { icon: StepIcon }) {
	const Icon = STEP_ICONS[icon]
	return <Icon className="i sm" strokeWidth={1.6} />
}
