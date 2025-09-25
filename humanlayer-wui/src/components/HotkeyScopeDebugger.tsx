import { useEffect, useState } from 'react'
import { scopeManager } from '../hooks/hotkeys/scopeManager'
import { useHotkeysContext } from 'react-hotkeys-hook'

export function HotkeyScopeDebugger() {
  const [stack, setStack] = useState(scopeManager.getStack())
  const { activeScopes } = useHotkeysContext()

  useEffect(() => {
    return scopeManager.subscribe(setStack)
  }, [])

  if (!import.meta.env.DEV) {
    return null
  }

  return (
    <div className="fixed top-4 right-4 bg-black/90 text-white p-4 rounded-lg max-w-md z-[9999]">
      <h3 className="text-xs font-bold mb-2">🎹 Hotkey Scope Stack</h3>
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
