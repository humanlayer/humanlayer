import { useEffect, useRef } from 'react'
import { useHotkeysContext } from 'react-hotkeys-hook'
import { logger } from '@/lib/logging'

export function useStealHotkeyScope(targetScope: string) {
  const { activeScopes, enableScope, disableScope } = useHotkeysContext()
  const initialScopesRef = useRef<string[]>([])

  useEffect(() => {
    initialScopesRef.current = activeScopes
    logger.log('disabling scopes (storing initial)', activeScopes)
    activeScopes.forEach(scope => disableScope(scope))
    logger.log('activating target scope', targetScope)
    enableScope(targetScope)

    return () => {
      logger.log('disabling target scope', targetScope)
      disableScope(targetScope)

      logger.log('enabling scopes', initialScopesRef.current)
      initialScopesRef.current.forEach(scope => enableScope(scope))
    }
  }, [])
}
