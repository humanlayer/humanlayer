import { useEffect, useState } from 'react'
import { scopeManager } from '../hooks/hotkeys/scopeManager'
import { useHotkeysContext, useHotkeys } from 'react-hotkeys-hook'
import { HotkeyScopeDebuggerIndicator } from './HotkeyScopeDebuggerIndicator'

export function HotkeyScopeDebugger() {
  const [stack, setStack] = useState(scopeManager.getStack())
  const [isVisible, setIsVisible] = useState(false)
  const { activeScopes } = useHotkeysContext()

  useEffect(() => {
    return scopeManager.subscribe(setStack)
  }, [])

  // Global hotkey to toggle debugger visibility (dev mode only)
  useHotkeys(
    'alt+shift+h',
    () => {
      setIsVisible(prev => !prev)
    },
    {
      // No scopes specified - works in wildcard scope
      enabled: import.meta.env.DEV,
      preventDefault: true,
    },
  )

  if (!import.meta.env.DEV) {
    return null
  }

  if (!isVisible) {
    return <HotkeyScopeDebuggerIndicator onToggle={() => setIsVisible(true)} />
  }

  return (
    <div className="fixed top-4 right-4 bg-black/90 text-white p-4 rounded-lg max-w-md z-[9999]">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-bold">🎹 Hotkey Scope Stack</h3>
        <button
          onClick={() => setIsVisible(false)}
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
