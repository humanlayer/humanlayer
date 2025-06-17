import React, { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { useStore } from '@/App'

interface MenuOption {
  id: string
  label: string
  description?: string
  action: () => void
}

interface CommandPaletteMenuProps {
  onClose: () => void
}

export default function CommandPaletteMenu() {
  const { createNewSession, openSessionById, selectedMenuIndex, setSelectedMenuIndex } =
    useSessionLauncher()

  // Get sessions from the main app store
  const sessions = useStore(state => state.sessions)

  // Build menu options
  const menuOptions: MenuOption[] = [
    {
      id: 'create-session',
      label: 'Create Session',
      description: 'Start a new session with AI assistance',
      action: createNewSession,
    },
    ...sessions.slice(0, 5).map(session => ({
      id: `open-${session.id}`,
      label: `Open ${session.query.slice(0, 40)}${session.query.length > 40 ? '...' : ''}`,
      description: `${session.status} • ${session.model || 'Unknown model'}`,
      action: () => openSessionById(session.id),
    })),
  ]

  // Keyboard navigation
  useHotkeys(
    'up',
    () => {
      setSelectedMenuIndex(selectedMenuIndex > 0 ? selectedMenuIndex - 1 : menuOptions.length - 1)
    },
    { enabled: true },
  )

  useHotkeys(
    'down',
    () => {
      setSelectedMenuIndex(selectedMenuIndex < menuOptions.length - 1 ? selectedMenuIndex + 1 : 0)
    },
    { enabled: true },
  )

  useHotkeys(
    'enter',
    () => {
      if (menuOptions[selectedMenuIndex]) {
        menuOptions[selectedMenuIndex].action()
      }
    },
    { enabled: true },
  )

  // Reset selection when options change
  useEffect(() => {
    if (selectedMenuIndex >= menuOptions.length) {
      setSelectedMenuIndex(0)
    }
  }, [menuOptions.length, selectedMenuIndex, setSelectedMenuIndex])

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground mb-3">
        Select an option or use arrow keys to navigate
      </div>

      {menuOptions.map((option, index) => (
        <div
          key={option.id}
          className={`
            p-3 rounded-lg cursor-pointer transition-all duration-150
            ${
              index === selectedMenuIndex
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/50 hover:bg-muted'
            }
          `}
          onClick={() => {
            setSelectedMenuIndex(index)
            option.action()
          }}
          onMouseEnter={() => setSelectedMenuIndex(index)}
        >
          <div className="font-medium">{option.label}</div>
          {option.description && (
            <div
              className={`text-xs mt-1 ${
                index === selectedMenuIndex ? 'text-primary-foreground/80' : 'text-muted-foreground'
              }`}
            >
              {option.description}
            </div>
          )}
        </div>
      ))}

      {menuOptions.length === 1 && (
        <div className="text-xs text-muted-foreground text-center mt-4">No recent sessions found</div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground mt-4 pt-3 border-t">
        <div className="flex items-center space-x-4">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
        </div>
        <span>ESC Close</span>
      </div>
    </div>
  )
}
