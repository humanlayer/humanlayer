import { useEffect, useState } from 'react'
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

interface MenuOption {
  id: string
  label: string
  description?: string
  action: () => void
  sessionId?: string
  hotkey?: string
}

export default function CommandPaletteMenu() {
  const { createNewSession, close } = useSessionLauncher()

  const [internalSearchValue, setInternalSearchValue] = useState('')
  const [selectedValue, setSelectedValue] = useState<string>('')

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
      className="rounded-lg border shadow-md [&_[cmdk-input]]:h-9"
      value={selectedValue}
      onValueChange={setSelectedValue}
      loop
    >
      <CommandInput
        placeholder="Type a command..."
        autoFocus
        className="border-0 font-mono text-sm"
        onValueChange={setInternalSearchValue}
      />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup className="p-0">
          {baseOptions.map(option => (
            <CommandItem
              key={option.id}
              value={option.id}
              keywords={[option.label, option.description || '']}
              onSelect={() => option.action()}
              className="flex items-center justify-between px-3 py-3 transition-all duration-150 cursor-pointer data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground hover:bg-muted/60"
            >
              <span className="text-sm font-medium">{option.label}</span>
              {option.hotkey && <KeyboardShortcut keyString={option.hotkey} />}
            </CommandItem>
          ))}
        </CommandGroup>
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
