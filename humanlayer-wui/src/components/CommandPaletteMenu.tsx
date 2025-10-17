import { RefObject } from 'react'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher, isViewingSessionDetail } from '@/hooks/useSessionLauncher'
import { useStore } from '@/AppStore'
import { KeyboardShortcut } from './HotkeyPanel'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { daemonClient } from '@/lib/daemon'
import { Session } from '@/lib/daemon/types'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

interface MenuOption {
  id: string
  label: string
  description?: string
  action: () => void
  sessionId?: string
  hotkey?: string
}

export default function CommandPaletteMenu({ ref }: { ref: RefObject<HTMLDivElement> }) {
  const { createNewSession, close } = useSessionLauncher()

  const [internalSearchValue, setInternalSearchValue] = useState('')
  const [selectedValue, setSelectedValue] = useState<string>('')
  const [sessionResults, setSessionResults] = useState<Session[]>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [selectedMenuIndex, setSelectedMenuIndex] = useState<number | null>(null)

  // Debounce search query for session search
  const debouncedQuery = useDebounce(internalSearchValue, 150)

  // Get sessions and state from the main app store
  const sessions = useStore(state => state.sessions)
  const focusedSession = useStore(state => state.focusedSession)
  const selectedSessions = useStore(state => state.selectedSessions)
  const activeSessionDetail = useStore(state => state.activeSessionDetail)
  const archiveSession = useStore(state => state.archiveSession)
  const bulkArchiveSessions = useStore(state => state.bulkArchiveSessions)
  const setSettingsDialogOpen = useStore(state => state.setSettingsDialogOpen)
  const setHotkeyPanelOpen = useStore(state => state.setHotkeyPanelOpen)

  // Check if we're viewing a session detail
  const isSessionDetail = isViewingSessionDetail()

  // Check if we should show archive option
  const isSessionTable = !isSessionDetail && window.location.hash === '#/'
  const shouldShowArchive =
    isSessionDetail || (isSessionTable && (focusedSession || selectedSessions.size > 0))

  // Determine if we should show unarchive instead of archive
  const getArchiveLabel = (): string => {
    if (isSessionDetail && activeSessionDetail) {
      return activeSessionDetail.session.archived ? 'Unarchive' : 'Archive'
    } else if (selectedSessions.size > 0) {
      // For bulk operations, check if all selected sessions have same archive state
      const sessionIds = Array.from(selectedSessions)
      const sessionsToCheck = sessions.filter(s => sessionIds.includes(s.id))
      const allArchived = sessionsToCheck.every(s => s.archived)
      const allActive = sessionsToCheck.every(s => !s.archived)

      // If mixed state, use "Archive" as default
      if (!allArchived && !allActive) {
        return 'Archive'
      }
      return allArchived ? 'Unarchive' : 'Archive'
    } else if (focusedSession) {
      return focusedSession.archived ? 'Unarchive' : 'Archive'
    }
    return 'Archive' // Default
  }

  // Build base menu options
  const baseOptions: MenuOption[] = [
    {
      id: 'create-session',
      label: 'Create Session',
      action: createNewSession,
      hotkey: 'C',
    },
    {
      id: 'open-settings',
      label: 'Settings',
      action: () => {
        setSettingsDialogOpen(true)
        close()
      },
      hotkey: '⌘+⇧+S',
    },
    {
      id: 'view-hotkey-map',
      label: 'View Hotkey Map',
      description: 'View all keyboard shortcuts',
      action: () => {
        close() // Close command palette first
        setHotkeyPanelOpen(true) // Then open hotkey panel
      },
      hotkey: '?',
    },
    ...(isSessionDetail && internalSearchValue.toLowerCase().includes('brain')
      ? [
          {
            id: 'toggle-brainrot',
            label: 'Brainrot Mode',
            action: () => {
              window.dispatchEvent(new CustomEvent('toggle-brainrot-mode'))
              close()
            },
          },
        ]
      : []),
    ...(shouldShowArchive
      ? [
          {
            id: 'archive-session',
            label: getArchiveLabel(),
            action: async () => {
              if (isSessionDetail && activeSessionDetail) {
                // Archive current session in detail view
                await archiveSession(
                  activeSessionDetail.session.id,
                  !activeSessionDetail.session.archived,
                )
                close()
              } else if (selectedSessions.size > 0) {
                // Bulk archive selected sessions
                const sessionIds = Array.from(selectedSessions)
                const sessionsToArchive = sessions.filter(s => sessionIds.includes(s.id))
                const allArchived = sessionsToArchive.every(s => s.archived)
                await bulkArchiveSessions(sessionIds, !allArchived)
                close()
              } else if (focusedSession) {
                // Archive focused session
                await archiveSession(focusedSession.id, !focusedSession.archived)
                close()
              }
            },
            hotkey: 'E',
          },
        ]
      : []),
  ]

  // Fetch sessions from backend when query changes
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setSessionResults([])
      return
    }

    let cancelled = false
    setIsLoadingSessions(true)

    const searchSessions = async () => {
      try {
        const response = await daemonClient.searchSessions({
          query: debouncedQuery,
          limit: 10,
        })

        if (!cancelled) {
          setSessionResults(response.data || [])
        }
      } catch (error) {
        console.error('Failed to search sessions:', error)
        if (!cancelled) {
          setSessionResults([])
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSessions(false)
        }
      }
    }

    searchSessions()

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, daemonClient])

  // Combine action and session options for keyboard navigation
  const allOptions = useMemo(() => {
    const actionOptions = baseOptions.map(action => ({
      type: 'action' as const,
      id: action.id,
      label: action.label,
      action: action.action,
      hotkey: action.hotkey,
    }))

    const sessionOptions = sessionResults.map(session => ({
      type: 'session' as const,
      id: session.id,
      label: session.title || session.summary || session.query,
      workingDir: session.workingDir,
      action: () => {
        window.location.hash = `#/sessions/${session.id}`
        close()
      },
    }))

    return [...actionOptions, ...sessionOptions]
  }, [baseOptions, sessionResults, close])

  // Update keyboard navigation to work with combined options
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMenuIndex(prev => (prev === null ? 0 : Math.min(prev + 1, allOptions.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMenuIndex(prev => (prev === null ? allOptions.length - 1 : Math.max(prev - 1, 0)))
      } else if (e.key === 'Enter' && selectedMenuIndex !== null) {
        e.preventDefault()
        const option = allOptions[selectedMenuIndex]
        if (option) {
          option.action()
        }
      }
    },
    [allOptions, selectedMenuIndex],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  // cmdk handles filtering internally - no manual filtering needed

  // Tab key navigates down the list
  useHotkeys(
    'tab',
    e => {
      if (baseOptions.length === 0) return
      e.preventDefault()

      const currentIndex = baseOptions.findIndex(opt => opt.id === selectedValue)
      const nextIndex = (currentIndex + 1) % baseOptions.length
      setSelectedValue(baseOptions[nextIndex].id)
    },
    {
      enabled: true,
      enableOnFormTags: true,
      scopes: [HOTKEY_SCOPES.SESSION_LAUNCHER],
      preventDefault: true,
    },
  )

  // Shift+Tab navigates up the list
  useHotkeys(
    'shift+tab',
    e => {
      if (baseOptions.length === 0) return
      e.preventDefault()

      const currentIndex = baseOptions.findIndex(opt => opt.id === selectedValue)
      const prevIndex = currentIndex <= 0 ? baseOptions.length - 1 : currentIndex - 1
      setSelectedValue(baseOptions[prevIndex].id)
    },
    {
      enabled: true,
      enableOnFormTags: true,
      scopes: [HOTKEY_SCOPES.SESSION_LAUNCHER],
      preventDefault: true,
    },
  )

  // Initialize selection to first item when component mounts
  useEffect(() => {
    if (baseOptions.length > 0 && !selectedValue) {
      setSelectedValue(baseOptions[0].id)
    }
  }, [baseOptions.length, selectedValue])

  return (
    <Command
      ref={ref}
      className="rounded-lg border shadow-md [&_[cmdk-input]]:h-9 max-w-2xl h-auto"
      value={selectedValue}
      onValueChange={setSelectedValue}
      loop
    >
      <CommandInput
        placeholder="Search commands and sessions..."
        autoFocus
        className="border-0 font-mono text-sm"
        onValueChange={setInternalSearchValue}
        value={internalSearchValue}
      />
      <CommandList className="max-h-[400px]">
        {/* Actions group */}
        {allOptions.filter(o => o.type === 'action').length > 0 && (
          <CommandGroup heading="Actions" className="p-0">
            {allOptions
              .filter(o => o.type === 'action')
              .map(option => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  keywords={[option.label]}
                  onSelect={option.action}
                  className={cn(
                    'flex items-center justify-between px-3 py-3 transition-all duration-150 cursor-pointer data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground hover:bg-muted/60',
                    selectedValue === option.id && 'bg-accent',
                  )}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  {option.hotkey && <KeyboardShortcut keyString={option.hotkey} />}
                </CommandItem>
              ))}
          </CommandGroup>
        )}

        {/* Sessions group */}
        {allOptions.filter(o => o.type === 'session').length > 0 && (
          <CommandGroup heading="Sessions" className="p-0">
            {allOptions
              .filter(o => o.type === 'session')
              .map(option => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  keywords={[option.label, option.workingDir].filter(Boolean) as string[]}
                  onSelect={option.action}
                  className={cn(
                    'flex flex-col items-start px-3 py-3 transition-all duration-150 cursor-pointer data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground hover:bg-muted/60',
                    selectedValue === option.id && 'bg-accent',
                  )}
                >
                  <span className="font-medium text-sm">{option.label}</span>
                  {option.workingDir && (
                    <span
                      className={cn(
                        'text-xs text-muted-foreground',
                        selectedValue === option.id && 'text-[var(--terminal-bg-alt)]',
                      )}
                    >
                      {option.workingDir}
                    </span>
                  )}
                </CommandItem>
              ))}
          </CommandGroup>
        )}

        {/* Loading state */}
        {isLoadingSessions && <CommandEmpty className="py-6">Searching sessions...</CommandEmpty>}

        {/* Empty state */}
        {!isLoadingSessions && internalSearchValue && allOptions.length === 0 && (
          <CommandEmpty className="py-6">No results found</CommandEmpty>
        )}
      </CommandList>
      <div className="flex items-center justify-between text-xs text-muted-foreground p-2 border-t">
        <div className="flex items-center space-x-3">
          <span>↑↓/Tab Navigate</span>
          <span>↵ Select</span>
        </div>
        <span>ESC Close</span>
      </div>
    </Command>
  )
}
