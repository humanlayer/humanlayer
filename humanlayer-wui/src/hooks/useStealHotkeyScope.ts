import { useEffect, useRef } from 'react'
import { useHotkeysContext } from 'react-hotkeys-hook'

export function useStealHotkeyScope(targetScope: string) {
  const { activeScopes, enableScope, disableScope } = useHotkeysContext()
  const initialScopesRef = useRef<string[]>([])

  useEffect(() => {
    initialScopesRef.current = activeScopes
    console.log('disabling scopes (storing initial)', activeScopes)
    activeScopes.forEach(scope => disableScope(scope))
    console.log('activating target scope', targetScope)
    enableScope(targetScope)

    return () => {
      console.log('disabling target scope', targetScope)
      disableScope(targetScope)

      console.log('enabling scopes', initialScopesRef.current)
      initialScopesRef.current.forEach(scope => enableScope(scope))
    }
  }, [])
}
