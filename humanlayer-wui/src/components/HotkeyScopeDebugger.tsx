import { useEffect, useState } from 'react'
import { scopeManager } from '../hooks/hotkeys/scopeManager'
import { useHotkeysContext } from 'react-hotkeys-hook'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDebugStore } from '@/stores/useDebugStore'

export function HotkeyScopeDebugger() {
  const [stack, setStack] = useState(scopeManager.getStack())
  const { activeScopes } = useHotkeysContext()
  const { showHotkeyDebugger, setShowHotkeyDebugger } = useDebugStore()

  useEffect(() => {
    return scopeManager.subscribe(setStack)
  }, [])

  // Global hotkey to toggle debugger visibility (dev mode only)
  useHotkeys(
    'alt+shift+h',
    () => {
      setShowHotkeyDebugger(!showHotkeyDebugger)
    },
    {
      // No scopes specified - works in wildcard scope
      enabled: import.meta.env.DEV,
      preventDefault: true,
    },
    [showHotkeyDebugger], // Add dependency to ensure fresh value
  )

  if (!import.meta.env.DEV || !showHotkeyDebugger) {
    return null
  }

  return (
    <div className="fixed top-4 right-4 bg-black/90 text-white p-4 rounded-lg max-w-md z-[9999]">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-bold">🎹 Hotkey Scope Stack</h3>
        <button
          onClick={() => setShowHotkeyDebugger(false)}
          className="text-gray-400 hover:text-white text-xs"
          title="Close (Alt+Shift+H)"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1">
        <div className="text-xs">
          <span className="text-gray-400">Active Scopes:</span>
          <span className="ml-2 text-green-400">{activeScopes.join(', ')}</span>
        </div>
        <div className="text-xs">
          <span className="text-gray-400">Stack ({stack.length}):</span>
        </div>
        {stack.map((entry, index) => (
          <div
            key={entry.id}
            className={`text-xs pl-4 ${index === stack.length - 1 ? 'text-yellow-400' : 'text-gray-300'}`}
          >
            {index === stack.length - 1 && '→ '}
            {entry.scope}
            {entry.component && ` (${entry.component})`}
            {entry.rootDisabled && ' [root disabled]'}
          </div>
        ))}
      </div>
    </div>
  )
}
