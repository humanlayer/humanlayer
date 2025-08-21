import { useEffect, useRef } from 'react'
import { useHotkeysContext } from 'react-hotkeys-hook'

export function useStealHotkeyScope(targetScope: string, enabled: boolean = true) {
  const { activeScopes, enableScope, disableScope } = useHotkeysContext()
  const initialScopesRef = useRef<string[]>([])
  const hasStolen = useRef(false)

  useEffect(() => {
    if (!enabled) {
      // If not enabled but we previously stole scopes, restore them
      if (hasStolen.current) {
        disableScope(targetScope)
        initialScopesRef.current.forEach(scope => enableScope(scope))
        hasStolen.current = false
      }
      return
    }

    // Only steal if we haven't already
    if (!hasStolen.current) {
      // Capture scopes at this exact moment
      const scopesToDisable = [...activeScopes]
      initialScopesRef.current = scopesToDisable

      scopesToDisable.forEach(scope => disableScope(scope))

      enableScope(targetScope)
      hasStolen.current = true
    }

    return () => {
      if (hasStolen.current) {
        disableScope(targetScope)

        // Add small delay to prevent race conditions
        setTimeout(() => {
          initialScopesRef.current.forEach(scope => enableScope(scope))
        }, 0)
        hasStolen.current = false
      }
    }
  }, [enabled, targetScope, enableScope, disableScope])
}
