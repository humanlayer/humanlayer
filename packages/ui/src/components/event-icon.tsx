import {
  AlignJustify,
  Bot,
  Brain,
  FilePenLine,
  FileText,
  Globe,
  HatGlasses,
  List,
  ListChecks,
  ListTodo,
  Minimize2,
  Search,
  Terminal,
  User,
  Wrench,
} from 'lucide-react'
import { normalizeToolName } from '../lib/tool-names'
import { cn } from '@humanlayer/ui/lib/utils'
import type { FC } from 'react'

export type EventType = 'message' | 'tool_call' | 'tool_result' | 'system'
export type EventRole = 'user' | 'assistant' | 'system'
export type IconSize = 'sm' | 'md' | 'lg'

const iconSizeClasses: Record<IconSize, string> = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
  lg: 'w-4 h-4',
}

type IconComponent = typeof Wrench

const toolIcons: Record<string, IconComponent> = {
  edit: FilePenLine,
  multiedit: FilePenLine,
  read: FileText,
  write: FilePenLine,
  applypatch: FilePenLine,
  bash: Terminal,
  ls: List,
  list: List,
  glob: Search,
  grep: Search,
  todowrite: ListTodo,
  websearch: Globe,
  webfetch: Globe,
  exitplanmode: ListChecks,
  notebookread: FileText,
  notebookedit: FileText,
  skill: AlignJustify,
}

const agentToolNames = new Set(['task', 'agent', 'subagent', 'functionsagent'])

function toolCallIcon(normalizedToolName: string, isNamedSubagent: boolean | undefined): IconComponent {
  if (normalizedToolName.startsWith('mcp')) return Globe
  if (agentToolNames.has(normalizedToolName)) return isNamedSubagent ? HatGlasses : Wrench
  return toolIcons[normalizedToolName] ?? Wrench
}

function resolveEventIcon(
  eventType: EventType,
  role: EventRole | undefined,
  toolName: string | undefined,
  isThinking: boolean | undefined,
  isNamedSubagent: boolean | undefined,
): IconComponent {
  if (eventType === 'tool_call') return toolCallIcon(normalizeToolName(toolName), isNamedSubagent)
  if (eventType === 'system') return Minimize2
  if (role === 'user') return User
  if (role === 'assistant') return isThinking ? Brain : Bot
  return Wrench
}

export interface EventIconProps {
  eventType: EventType
  role?: EventRole
  toolName?: string
  isCompleted?: boolean
  isThinking?: boolean
  isNamedSubagent?: boolean
  size?: IconSize
  className?: string
}

export const EventIcon: FC<EventIconProps> = ({
  eventType,
  role,
  toolName,
  isCompleted,
  isThinking,
  isNamedSubagent,
  size = 'lg',
  className,
}) => {
  const pulseClass =
    eventType === 'tool_call' && !isCompleted ? 'pulse-warning text-[var(--terminal-warning)]' : ''
  const iconClasses = cn(iconSizeClasses[size], 'align-middle relative top-[1px]', pulseClass, className)
  const Icon = resolveEventIcon(eventType, role, toolName, isThinking, isNamedSubagent)

  return <Icon className={iconClasses} />
}
