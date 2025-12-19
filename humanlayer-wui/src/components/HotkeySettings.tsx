import React, { useState } from 'react'
import { HOTKEY_DEFINITIONS, HOTKEY_CATEGORY_LABELS, HotkeyId } from '@/config/hotkeys'
import { useHotkeyStore } from '@/stores/hotkeyStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHotkeyUnicodeChars, formatBindingForDisplay } from '@/hooks/useHotkeyUnicodeChars'
import { RotateCcw, AlertTriangle, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'

export function HotkeySettings() {
  const { getBinding, setBinding, resetBinding, resetAllBindings, checkConflict } = useHotkeyStore()
  const { isMac } = useHotkeyUnicodeChars()
  const [editingId, setEditingId] = useState<HotkeyId | null>(null)
  const [editValue, setEditValue] = useState('')
  const [conflictId, setConflictId] = useState<HotkeyId | null>(null)

  // Get unique categories in order
  const categoryOrder: Array<keyof typeof HOTKEY_CATEGORY_LABELS> = [
    'global',
    'navigation',
    'sessions',
    'selection',
    'session-detail',
  ]

  const handleStartEdit = (id: HotkeyId) => {
    setEditingId(id)
    setEditValue(getBinding(id))
    setConflictId(null)
  }

  const handleSave = () => {
    if (!editingId) return

    const conflict = checkConflict(editValue, editingId)
    if (conflict) {
      setConflictId(conflict)
      return
    }

    setBinding(editingId, editValue)
    setEditingId(null)
    setEditValue('')
    setConflictId(null)
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditValue('')
    setConflictId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Keyboard Shortcuts</h3>
        <Button variant="outline" size="sm" onClick={resetAllBindings}>
          <RotateCcw className="mr-2 h-3 w-3" />
          Reset All
        </Button>
      </div>

      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-6">
          {categoryOrder.map(category => {
            const hotkeysInCategory = Object.entries(HOTKEY_DEFINITIONS).filter(
              ([, def]) => def.category === category,
            )

            if (hotkeysInCategory.length === 0) return null

            return (
              <div key={category} className="space-y-2">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground border-b pb-1">
                  {HOTKEY_CATEGORY_LABELS[category]}
                </h4>

                <div className="space-y-1">
                  {hotkeysInCategory.map(([id, def]) => {
                    const hotkeyId = id as HotkeyId
                    const isEditing = editingId === hotkeyId
                    const currentBinding = getBinding(hotkeyId)
                    const isCustom = currentBinding !== def.defaultKey

                    return (
                      <div
                        key={id}
                        className={cn(
                          'flex items-center justify-between py-1.5 px-2 rounded-sm',
                          isEditing ? 'bg-muted' : 'hover:bg-muted/50',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <Label className="text-sm font-normal">{def.label}</Label>
                          <p className="text-xs text-muted-foreground truncate">{def.description}</p>
                        </div>

                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                          {isEditing ? (
                            <>
                              <Input
                                value={editValue}
                                onChange={e => {
                                  setEditValue(e.target.value)
                                  setConflictId(null)
                                }}
                                onKeyDown={handleKeyDown}
                                className="w-36 h-7 text-xs font-mono"
                                placeholder="e.g., ctrl+shift+k"
                                autoFocus
                              />
                              {conflictId && (
                                <span className="text-xs text-destructive flex items-center gap-1 whitespace-nowrap">
                                  <AlertTriangle className="h-3 w-3" />
                                  Conflicts with {HOTKEY_DEFINITIONS[conflictId].label}
                                </span>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={handleCancel}
                                title="Cancel"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={handleSave}
                                title="Save"
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  'h-auto px-2 py-0.5 bg-muted rounded text-xs font-mono hover:bg-muted/80',
                                  isCustom && 'ring-1 ring-primary/30',
                                )}
                                onClick={() => handleStartEdit(hotkeyId)}
                                title="Click to edit"
                              >
                                {formatBindingForDisplay(currentBinding, isMac)}
                              </Button>
                              {isCustom && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5"
                                  onClick={() => resetBinding(hotkeyId)}
                                  title="Reset to default"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        Use format like <code className="bg-muted px-1 rounded">meta+shift+k</code> for keyboard
        shortcuts. Use <code className="bg-muted px-1 rounded">meta</code> for Cmd/Ctrl,{' '}
        <code className="bg-muted px-1 rounded">alt</code> for Option/Alt. Separate alternatives with
        commas.
      </p>
    </div>
  )
}
