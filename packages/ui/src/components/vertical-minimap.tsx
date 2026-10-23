import { cn } from '@humanlayer/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type FC, useCallback, useMemo, useRef } from 'react'
import { isAgentToolName, normalizeToolName } from '../lib/tool-names'
import { useMountEffect } from '../hooks/use-mount-effect'
import { contextCompactionTokensLabel, parseContextCompaction } from './conversation-stream/utils/context-compaction'
import { formatFilePath } from './conversation-stream/utils/formatters'
import { EventIcon, type EventType, type EventRole } from './event-icon'

const MINIMAP_AT_BOTTOM_THRESHOLD_PX = 72

// --- Types ---

export type ApprovalStatus = 'pending' | 'approved' | 'denied'

export interface MinimapEvent {
  id: string
  eventType: EventType
  role?: EventRole
  toolName?: string
  toolId?: string
  parentToolUseId?: string
  approvalStatus?: ApprovalStatus
  isCompleted?: boolean
  toolInputJson?: string
  content?: string
}

interface AgentEventGroup {
  parentAgent: MinimapEvent
  subAgentEvents: MinimapEvent[]
  toolCallCount: number
  hasPendingApproval: boolean
}

interface EventTextParts {
  prefix: string
  content: string
  detail?: string
  isNamedSubagent?: boolean
}

function splitFilePath(filePath: string): { fileName: string; pathDetail?: string } {
  const fileName = filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
  return fileName === filePath ? { fileName } : { fileName, pathDetail: filePath }
}

function formatToolNameLabel(name: string | undefined): string {
  if (!name) return 'Tool'

  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length === 0) return name

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function safeParseToolInput(toolInputJson: string | undefined): Record<string, unknown> {
  if (!toolInputJson) return {}

  try {
    const parsed = JSON.parse(toolInputJson)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// --- Event Text Parsing ---

function getEventTextParts(event: MinimapEvent, workingDirectory?: string): EventTextParts {
  const type = event?.eventType
  const toolName = event?.toolName
  const normalizedToolName = normalizeToolName(toolName)
  const toolInput = safeParseToolInput(event?.toolInputJson)

  switch (type) {
    case 'tool_call':
      switch (normalizedToolName) {
        case 'write':
        case 'read':
        case 'edit': {
          const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : 'file'
          const displayPath = formatFilePath(filePath, workingDirectory)
          const { fileName, pathDetail } = splitFilePath(displayPath)
          return {
            prefix: normalizedToolName.charAt(0).toUpperCase() + normalizedToolName.slice(1),
            content: fileName,
            detail: pathDetail,
          }
        }
        case 'bash': {
          const cmd = typeof toolInput.command === 'string' ? toolInput.command : ''
          return {
            prefix: 'Bash',
            content: cmd.slice(0, 30) + (cmd.length > 30 ? '...' : ''),
          }
        }
        case 'task':
        case 'agent':
        case 'subagent':
        case 'functionsagent': {
          const agentName =
            typeof toolInput.subagent_type === 'string' && toolInput.subagent_type.length > 0
              ? toolInput.subagent_type
              : formatToolNameLabel(event?.toolName)
          const description = typeof toolInput.description === 'string' ? toolInput.description : ''
          return {
            prefix: agentName,
            content: description,
            isNamedSubagent: typeof toolInput.subagent_type === 'string' && toolInput.subagent_type.length > 0,
          }
        }
        case 'skill': {
          const skillName = typeof toolInput.skill === 'string'
            ? toolInput.skill
            : typeof toolInput.name === 'string'
              ? toolInput.name
              : ''
          return {
            prefix: 'Skill',
            content: skillName,
          }
        }
        case 'mcphumanlayerupdateartifactcomments': {
          const artifactName = typeof toolInput.artifact_filename === 'string' ? toolInput.artifact_filename : ''
          return { prefix: 'CommentResolve', content: artifactName }
        }
        case 'mcphumanlayerreplytoartifactcomment': {
          const artifactName = typeof toolInput.artifact_filename === 'string' ? toolInput.artifact_filename : ''
          return { prefix: 'CommentReply', content: artifactName }
        }
        case 'mcphumanlayergetartifactcomments': {
          const artifactName = typeof toolInput.artifact_filename === 'string' ? toolInput.artifact_filename : ''
          return { prefix: 'CommentGet', content: artifactName }
        }
        default:
          return { prefix: formatToolNameLabel(toolName), content: '' }
      }
    case 'message':
      return {
        prefix: event?.role === 'user' ? 'User' : 'Assistant',
        content: event?.content || '',
      }
    case 'system': {
      const compaction = parseContextCompaction({ eventType: 'system', content: event?.content })
      if (compaction) {
        return { prefix: 'Compacted', content: contextCompactionTokensLabel(compaction) }
      }
      return { prefix: 'Event', content: '' }
    }
    default:
      return { prefix: 'Event', content: '' }
  }
}

// --- Agent Grouping Logic ---

function buildAgentGroups(events: MinimapEvent[]): {
  agentGroups: Map<string, AgentEventGroup>
  rootEvents: MinimapEvent[]
  hasSubAgents: boolean
  groupedChildEventIds: Set<string>
} {
  const hasSubAgents = events.some((e) => e.parentToolUseId)
  if (!hasSubAgents) {
    return {
      agentGroups: new Map(),
      rootEvents: events,
      hasSubAgents: false,
      groupedChildEventIds: new Set(),
    }
  }

  const agentGroups = new Map<string, AgentEventGroup>()
  const rootEvents: MinimapEvent[] = []
  const eventsByParent = new Map<string, MinimapEvent[]>()
  const groupedChildEventIds = new Set<string>()

  events.forEach((event) => {
    if (event.parentToolUseId) {
      const siblings = eventsByParent.get(event.parentToolUseId) || []
      siblings.push(event)
      eventsByParent.set(event.parentToolUseId, siblings)
    } else {
      rootEvents.push(event)
    }
  })

  rootEvents.forEach((event) => {
    if (event.eventType !== 'tool_call' || !event.toolId || !eventsByParent.has(event.toolId)) {
      return
    }

    if (!isAgentToolName(event.toolName)) {
      return
    }

    const subEvents = eventsByParent.get(event.toolId)!
    const toolCalls = subEvents.filter((e) => e.eventType === 'tool_call')

    for (const subEvent of subEvents) {
      groupedChildEventIds.add(subEvent.id)
    }

    agentGroups.set(event.toolId, {
      parentAgent: event,
      subAgentEvents: subEvents,
      toolCallCount: toolCalls.length,
      hasPendingApproval: subEvents.some((e) => e.approvalStatus === 'pending'),
    })
  })

  return { agentGroups, rootEvents, hasSubAgents: true, groupedChildEventIds }
}

function isMinimapRowFocused(
  event: MinimapEvent,
  focusedEventId: string | null,
  agentGroups: Map<string, AgentEventGroup>,
): boolean {
  if (focusedEventId === null) return false
  if (event.id === focusedEventId) return true
  const agentGroup = event.toolId ? agentGroups.get(event.toolId) : undefined
  return agentGroup?.subAgentEvents.some((subEvent) => subEvent.id === focusedEventId) ?? false
}

export function getVisibleMinimapEvents(events: MinimapEvent[], maxEventIndex?: number): MinimapEvent[] {
  const filteredEvents = maxEventIndex === undefined ? events : events.slice(0, maxEventIndex)
  const { agentGroups, rootEvents, hasSubAgents, groupedChildEventIds } = buildAgentGroups(filteredEvents)
  const nonResultEvents = filteredEvents.filter((event) => event.eventType !== 'tool_result')
  if (!hasSubAgents) return nonResultEvents

  const rootNonResults = rootEvents.filter((event) => event.eventType !== 'tool_result')
  if (agentGroups.size === 0) return nonResultEvents

  const orphanChildEvents = nonResultEvents.filter(
    (event) => event.parentToolUseId && !groupedChildEventIds.has(event.id),
  )
  if (orphanChildEvents.length === 0) return rootNonResults

  const visibleEventIds = new Set<string>([
    ...rootNonResults.map((event) => event.id),
    ...orphanChildEvents.map((event) => event.id),
  ])
  return nonResultEvents.filter((event) => visibleEventIds.has(event.id))
}

// --- VerticalMinimapBlock Component ---

interface VerticalMinimapBlockProps {
  event: MinimapEvent
  workingDirectory?: string
  isFocused: boolean
  onClick: () => void
  agentGroup?: AgentEventGroup
  'data-event-id'?: string
}

const VerticalMinimapBlock: FC<VerticalMinimapBlockProps> = ({
  event,
  workingDirectory,
  isFocused,
  onClick,
  agentGroup,
  'data-event-id': dataEventId,
}) => {
  const isDenied = event?.approvalStatus === 'denied'
  let hasPendingApproval = Boolean(event?.approvalStatus === 'pending')

  // Check if any sub-agents have pending approval
  if (agentGroup) {
    hasPendingApproval = agentGroup.hasPendingApproval
  }

  const textParts = getEventTextParts(event, workingDirectory)

  return (
    <div
      data-event-id={dataEventId}
      className={cn(
        'relative flex items-center justify-start px-2 py-1.5 transition-[background-color,border-color,opacity] duration-200 w-full h-8 shrink-0 animate-in border-l-4 border-transparent gap-1.5',
        {
          // Background colors based on event type - consistent opacity for all states
          'bg-[color-mix(in_srgb,var(--terminal-color-2)_25%,transparent)]':
            event?.eventType === 'message' && event?.role === 'user' && !isDenied,
          'bg-[color-mix(in_srgb,var(--terminal-color-3)_25%,transparent)]':
            event?.eventType === 'message' && event?.role === 'assistant' && !isDenied,
          'bg-[color-mix(in_srgb,var(--terminal-color-5)_25%,transparent)]':
            event?.eventType === 'tool_call' && !isDenied,
          'bg-[color-mix(in_srgb,var(--terminal-color-1)_30%,transparent)]': isDenied,
          // Focus indicator - thick left border
          '!border-l-foreground': isFocused,
          // Pulse animation for pending approval. will-change promotes the row to its
          // own compositor layer so the infinite opacity loop doesn't re-rasterize the
          // minimap every frame on the main thread (WKWebView FPS drop otherwise).
          'animate-pulse will-change-[opacity]': hasPendingApproval,
          // Interaction - subtle hover effect
          'cursor-pointer hover:opacity-80': onClick,
        },
      )}
      onClick={onClick}
    >
      <span className="flex-shrink-0">
        <EventIcon
          eventType={event.eventType}
          role={event.role}
          toolName={event.toolName}
          isCompleted={event.isCompleted}
          isNamedSubagent={textParts.isNamedSubagent}
          size="sm"
          className="text-foreground"
        />
      </span>
      <span
        className="text-xs font-mono text-foreground flex flex-1 min-w-0 items-center"
        title={
          textParts.detail ? `${textParts.prefix} ${textParts.content} (${textParts.detail})` : undefined
        }
      >
        <span className="font-semibold shrink-0">{textParts.prefix}</span>
        {textParts.content && (
          <span className={cn('truncate', textParts.detail && 'ml-1 shrink-0 max-w-[45%]')}>
            {textParts.detail ? textParts.content : `: ${textParts.content}`}
          </span>
        )}
        {textParts.detail && (
          <span className="ml-1 flex min-w-0 flex-1">
            <span className="shrink-0">(</span>
            <span className="truncate">{textParts.detail}</span>
            <span className="shrink-0">)</span>
          </span>
        )}
      </span>
      {agentGroup && (agentGroup?.subAgentEvents?.length ?? 0) > 0 && (
        <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">+{agentGroup.toolCallCount}</span>
      )}
    </div>
  )
}

// --- Main VerticalMinimap Component ---

export interface VerticalMinimapProps {
  events: MinimapEvent[]
  workingDirectory?: string
  focusedEventId: string | null
  onEventClick?: (eventId: string) => void
  isRunning?: boolean
  maxEventIndex?: number
  className?: string
  virtualized?: boolean
}

const MinimapScrollSynchronizer: FC<{ synchronize: () => void }> = ({ synchronize }) => {
  useMountEffect(synchronize)
  return null
}

export const VerticalMinimap: FC<VerticalMinimapProps> = ({
  events,
  workingDirectory,
  focusedEventId,
  onEventClick,
  isRunning = false,
  maxEventIndex,
  className,
  virtualized = true,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollCleanupRef = useRef<(() => void) | null>(null)
  const updateIsAtBottomRef = useRef<(() => void) | null>(null)
  const isAtBottomRef = useRef(true)
  const hasPositionedRef = useRef(false)
  const previousRowCountRef = useRef(0)
  const previousFocusedEventIdRef = useRef<string | null>(focusedEventId)
  const previousFocusedRowIndexRef = useRef(-1)

  // Filter events by maxEventIndex if provided
  const filteredEvents = useMemo(() => {
    if (maxEventIndex === undefined) return events
    return events.slice(0, maxEventIndex)
  }, [events, maxEventIndex])

  // Build agent groups
  const { agentGroups } = useMemo(
    () => buildAgentGroups(filteredEvents),
    [filteredEvents],
  )

  // Filter out tool results for rendering
  const eventsToRender = useMemo(
    () => getVisibleMinimapEvents(events, maxEventIndex),
    [events, maxEventIndex],
  )

  const rowVirtualizer = useVirtualizer({
    count: eventsToRender.length + (isRunning ? 1 : 0),
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36,
    getItemKey: (index) => eventsToRender[index]?.id ?? `running-${index}`,
    overscan: 12,
    enabled: virtualized,
  })

  const rowCount = eventsToRender.length + (isRunning ? 1 : 0)
  const focusedRowIndex = useMemo(() => {
    if (focusedEventId === null) return -1
    return eventsToRender.findIndex((event) => isMinimapRowFocused(event, focusedEventId, agentGroups))
  }, [agentGroups, eventsToRender, focusedEventId])

  const setScrollContainer = useCallback((container: HTMLDivElement | null) => {
    scrollCleanupRef.current?.()
    scrollCleanupRef.current = null
    scrollContainerRef.current = container
    updateIsAtBottomRef.current = null
    if (!container) return

    const updateIsAtBottom = () => {
      isAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < MINIMAP_AT_BOTTOM_THRESHOLD_PX
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateIsAtBottom)

    updateIsAtBottom()
    updateIsAtBottomRef.current = updateIsAtBottom
    resizeObserver?.observe(container)
    container.addEventListener('scroll', updateIsAtBottom, { passive: true })
    scrollCleanupRef.current = () => {
      resizeObserver?.disconnect()
      container.removeEventListener('scroll', updateIsAtBottom)
    }
  }, [])

  const synchronizeScroll = useCallback(() => {
    const container = scrollContainerRef.current
    const isInitialPosition = !hasPositionedRef.current
    const previousRowCount = previousRowCountRef.current
    const focusTargetChanged =
      previousFocusedEventIdRef.current !== focusedEventId || previousFocusedRowIndexRef.current !== focusedRowIndex

    hasPositionedRef.current = true
    previousRowCountRef.current = rowCount
    previousFocusedEventIdRef.current = focusedEventId
    previousFocusedRowIndexRef.current = focusedRowIndex
    if (!container || rowCount === 0) return

    const shouldRevealFocus = focusedRowIndex >= 0 && (isInitialPosition || focusTargetChanged)
    if (shouldRevealFocus) {
      if (virtualized) {
        rowVirtualizer.scrollToIndex(focusedRowIndex, { align: 'auto' })
      } else {
        const visibleEventId = eventsToRender[focusedRowIndex]?.id
        const focusedElement = visibleEventId
          ? (container.querySelector(`[data-event-id="${visibleEventId}"]`) as HTMLElement | null)
          : null
        const elementRect = focusedElement?.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        if (elementRect && elementRect.top < containerRect.top) {
          container.scrollTop -= containerRect.top - elementRect.top
        } else if (elementRect && elementRect.bottom > containerRect.bottom) {
          container.scrollTop += elementRect.bottom - containerRect.bottom
        }
        updateIsAtBottomRef.current?.()
      }
      return
    }

    const visibleRowCountGrew = rowCount > previousRowCount
    if (isInitialPosition || (visibleRowCountGrew && isAtBottomRef.current)) {
      if (virtualized) {
        rowVirtualizer.scrollToIndex(rowCount - 1, { align: 'end' })
      } else {
        container.scrollTop = container.scrollHeight
        updateIsAtBottomRef.current?.()
      }
    }
  }, [eventsToRender, focusedEventId, focusedRowIndex, rowCount, rowVirtualizer, virtualized])

  const scrollSynchronizationKey = `${rowCount}:${focusedEventId ?? ''}:${focusedRowIndex}:${virtualized}`

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div ref={setScrollContainer} className="flex-1 overflow-y-auto pr-1 vertical-minimap-scrollbar">
        <MinimapScrollSynchronizer key={scrollSynchronizationKey} synchronize={synchronizeScroll} />
        {virtualized ? (
          <div className="relative p-1" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const event = eventsToRender[virtualRow.index]
              if (!event) {
                return isRunning ? (
                  <div
                    key={virtualRow.key}
                    className="absolute left-1 right-1 w-[calc(100%-0.5rem)] h-8 shrink-0 animate-pulse bg-[var(--terminal-accent)] opacity-50"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  />
                ) : null
              }

              const agentGroup = event.toolId ? agentGroups.get(event.toolId) : undefined
              const isFocused = isMinimapRowFocused(event, focusedEventId, agentGroups)

              return (
                <div
                  key={virtualRow.key}
                  className="absolute left-1 right-1 w-[calc(100%-0.5rem)]"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <VerticalMinimapBlock
                    event={event}
                    workingDirectory={workingDirectory}
                    isFocused={isFocused}
                    agentGroup={agentGroup}
                    data-event-id={event.id}
                    onClick={() => onEventClick?.(event.id)}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-1">
            {eventsToRender.map((event) => {
              const agentGroup = event.toolId ? agentGroups.get(event.toolId) : undefined
              const isFocused = isMinimapRowFocused(event, focusedEventId, agentGroups)

              return (
                <VerticalMinimapBlock
                  key={event.id}
                  event={event}
                  workingDirectory={workingDirectory}
                  isFocused={isFocused}
                  agentGroup={agentGroup}
                  data-event-id={event.id}
                  onClick={() => onEventClick?.(event.id)}
                />
              )
            })}
            {isRunning && (
              <div className="w-full h-8 shrink-0 animate-pulse bg-[var(--terminal-accent)] opacity-50" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
