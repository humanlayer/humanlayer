import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useHotkeys } from 'react-hotkeys-hook'
import { useHotkeyUnicodeChars, formatHotkeyForDisplay } from '@/hooks/useHotkeyUnicodeChars'

interface HotkeyPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Temporary hardcoded hotkey data
const hotkeyData = [
  // Global
  { category: 'Global', key: '?', description: 'Toggle keyboard shortcuts' },
  { category: 'Global', key: '⌘+K', description: 'Open command palette' },
  { category: 'Global', key: 'C', description: 'Create new session' },
  { category: 'Global', key: 'G,S', description: 'Go to sessions' },
  { category: 'Global', key: 'G,E', description: 'Go to archived sessions' },
  { category: 'Global', key: '⌘+T', description: 'Toggle theme selector' },
  { category: 'Global', key: '⌘+Enter', description: 'Submit text input' },
  { category: 'Global', key: '⌘+⇧+J', description: 'Jump to most recent approval' },
  { category: 'Global', key: '⌘+⇧+S', description: 'Toggle settings dialog' },
  { category: 'Global', key: '⌘+⇧+F', description: 'Open feedback URL' },
  { category: 'Global', key: '⌘+⇧+Y', description: 'Toggle launch theme' },

  // Session List
  { category: 'Session List', key: 'J', description: 'Move down' },
  { category: 'Session List', key: 'K', description: 'Move up' },
  { category: 'Session List', key: 'G,G', description: 'Jump to top' },
  { category: 'Session List', key: '⇧+G', description: 'Jump to bottom' },
  { category: 'Session List', key: '⌘+A', description: 'Select all' },
  { category: 'Session List', key: 'X', description: 'Toggle selection' },
  { category: 'Session List', key: '⇧+J', description: 'Select downward' },
  { category: 'Session List', key: '⇧+K', description: 'Select upward' },
  { category: 'Session List', key: 'Enter', description: 'Open session' },
  { category: 'Session List', key: 'E', description: 'Archive/unarchive' },
  { category: 'Session List', key: '⇧+R', description: 'Rename session' },
  { category: 'Session List', key: 'Tab', description: 'Toggle normal/archived view' },
  { category: 'Session List', key: 'Escape', description: 'Exit archived view' },

  // Session Detail
  { category: 'Session Detail', key: 'Escape', description: 'Close detail view' },
  { category: 'Session Detail', key: 'J', description: 'Next event' },
  { category: 'Session Detail', key: 'K', description: 'Previous event' },
  { category: 'Session Detail', key: 'G,G', description: 'Scroll to top' },
  { category: 'Session Detail', key: '⇧+G', description: 'Scroll to bottom' },
  { category: 'Session Detail', key: 'U', description: 'Jump to last user message' },
  { category: 'Session Detail', key: 'I', description: 'Inspect tool/sub-agent details' },
  { category: 'Session Detail', key: 'H', description: 'Expand/collapse sub-agent group' },
  { category: 'Session Detail', key: 'L', description: 'Collapse task group' },
  { category: 'Session Detail', key: 'A', description: 'Approve' },
  { category: 'Session Detail', key: 'D', description: 'Deny' },
  { category: 'Session Detail', key: 'E', description: 'Archive session' },
  { category: 'Session Detail', key: '⇧+R', description: 'Rename session' },
  { category: 'Session Detail', key: '⇧+M', description: 'Change model' },
  { category: 'Session Detail', key: 'Ctrl+X', description: 'Interrupt session' },
  { category: 'Session Detail', key: 'P', description: 'Go to parent session' },
  { category: 'Session Detail', key: '⌘+Y', description: 'Toggle fork view' },
  { category: 'Session Detail', key: '⌥+A', description: 'Toggle auto-accept edits' },
  { category: 'Session Detail', key: 'Enter', description: 'Focus response input' },
  { category: 'Session Detail', key: '⌘+Enter', description: 'Submit response' },
  { category: 'Session Detail', key: '⌥+Y', description: 'Toggle bypass permissions' },
]

export const KeyboardShortcut = ({ keyString }: { keyString: string }) => {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 select-none items-center gap-1',
        'rounded border bg-muted px-1.5 font-mono text-sm font-medium',
        'text-muted-foreground',
      )}
    >
      {keyString}
    </kbd>
  )
}

export function HotkeyPanel({ open, onOpenChange }: HotkeyPanelProps) {
  const unicodeChars = useHotkeyUnicodeChars()

  // Format hotkey data with OS-specific keys
  const formattedHotkeyData = hotkeyData.map(item => ({
    ...item,
    key: formatHotkeyForDisplay(item.key, unicodeChars),
  }))

  // Group hotkeys by category
  const groupedHotkeys = formattedHotkeyData.reduce(
    (acc, hotkey) => {
      if (!acc[hotkey.category]) {
        acc[hotkey.category] = []
      }
      acc[hotkey.category].push(hotkey)
      return acc
    },
    {} as Record<string, typeof formattedHotkeyData>,
  )

  // Handle J/K navigation for scrolling
  useHotkeys(
    'j',
    () => {
      // Scroll down
      const commandList = document.querySelector('[cmdk-list]')
      if (commandList) {
        commandList.scrollTop += 40
      }
    },
    {
      enabled: open,
      scopes: [HOTKEY_SCOPES.KEYBOARD_HELPER],
    },
  )

  useHotkeys(
    'k',
    () => {
      // Scroll up
      const commandList = document.querySelector('[cmdk-list]')
      if (commandList) {
        commandList.scrollTop -= 40
      }
    },
    {
      enabled: open,
      scopes: [HOTKEY_SCOPES.KEYBOARD_HELPER],
    },
  )

  useHotkeys(
    'escape',
    () => {
      onOpenChange(false)
    },
    {
      enabled: open,
      scopes: [HOTKEY_SCOPES.KEYBOARD_HELPER],
    },
  )

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.KEYBOARD_HELPER}
      isActive={open}
      rootScopeDisabled={true}
      componentName="HotkeyPanel"
    >
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              'fixed inset-0 z-50 bg-black/50',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            )}
          />
          <DialogPrimitive.Content
            className={cn(
              'fixed right-0 top-0 bottom-0 z-50 h-full w-full max-w-[400px]',
              'bg-background shadow-xl',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
              'duration-200',
            )}
          >
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b px-4 py-3">
                <DialogPrimitive.Title>Keyboard Shortcuts</DialogPrimitive.Title>
                <DialogPrimitive.Close className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              </div>

              {/* Command component for filtering */}
              <Command className="flex-1 overflow-hidden">
                <CommandInput placeholder="Search shortcuts..." className="h-11" autoFocus />
                <CommandList className="max-h-none">
                  <CommandEmpty>No shortcuts found.</CommandEmpty>
                  {Object.entries(groupedHotkeys).map(([category, hotkeys]) => (
                    <CommandGroup key={category} heading={category} className="py-3">
                      {hotkeys.map((hotkey, index) => (
                        <CommandItem
                          key={`${category}-${index}`}
                          value={`${hotkey.description} ${hotkey.key} ${category}`}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm">{hotkey.description}</span>
                          <KeyboardShortcut
                            keyString={formatHotkeyForDisplay(hotkey.key, unicodeChars)}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </HotkeyScopeBoundary>
  )
}
