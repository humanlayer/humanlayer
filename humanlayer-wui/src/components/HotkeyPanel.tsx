import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useMemo } from 'react'
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
import { getHotkeysByCategory, type HotkeyCategory } from '@/config/hotkeys'

interface HotkeyPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Category display names
const CATEGORY_NAMES: Record<HotkeyCategory, string> = {
  global: 'Global',
  session_list: 'Session List',
  session_detail: 'Session Detail',
}

export function HotkeyPanel({ open, onOpenChange }: HotkeyPanelProps) {
  // Get hotkeys from registry only
  const groupedHotkeys = useMemo(() => {
    const categories: HotkeyCategory[] = ['global', 'session_list', 'session_detail']
    const groups: Record<string, Array<{ key: string; description: string }>> = {}

    // Add registry hotkeys only
    categories.forEach(category => {
      const registryHotkeys = getHotkeysByCategory(category)
      if (registryHotkeys.length > 0) {
        groups[CATEGORY_NAMES[category]] = registryHotkeys.map(hk => ({
          key: hk.key,
          description: hk.description,
        }))
      }
    })
    return groups
  }, [])

  return (
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
              <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
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
                  <CommandGroup key={category} heading={category}>
                      {hotkeys.map((hotkey, index) => (
                        <CommandItem
                        key={`${category}-${index}`}
                        value={`${hotkey.description} ${hotkey.key} ${category}`}
                        className="flex items-center justify-between py-3 data-[selected=true]:bg-transparent"
                      >
                        <span className="text-sm text-foreground">{hotkey.description}</span>
                        <kbd
                          className={cn(
                            'pointer-events-none inline-flex h-5 select-none items-center gap-1',
                            'rounded border bg-muted px-1.5 font-mono text-[10px] font-medium',
                            'text-foreground',
                          )}
                        >
                          {hotkey.key}
                        </kbd>
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
  )
}
