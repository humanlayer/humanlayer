import React, { useEffect, useRef } from 'react'
import { useHotkeysContext } from 'react-hotkeys-hook'
import { scopeManager } from '../hooks/hotkeys/scopeManager'
import { HotkeyScope, HOTKEY_SCOPES } from '../hooks/hotkeys/scopes'
import { nanoid } from 'nanoid'

interface HotkeyScopeBoundaryProps {
  scope: HotkeyScope
  isActive?: boolean // For modals/conditionally visible components
  rootScopeDisabled?: boolean
  componentName?: string // For debugging
  children: React.ReactNode
}

export function HotkeyScopeBoundary({
  scope,
  isActive = true,
  rootScopeDisabled = false,
  componentName,
  children,
}: HotkeyScopeBoundaryProps) {
  const { enableScope, disableScope, activeScopes } = useHotkeysContext()
  const entryIdRef = useRef<string>()
  const previousScopesRef = useRef<string[]>([])

  useEffect(() => {
    if (!isActive) return

    // Generate unique ID for this boundary instance
    const entryId = nanoid()
    entryIdRef.current = entryId

    // Capture current active scopes
    previousScopesRef.current = [...activeScopes]

    // Push to stack
    scopeManager.push({
      id: entryId,
      scope,
      rootDisabled: rootScopeDisabled,
      timestamp: Date.now(),
      component: componentName,
    })

    // Apply scope changes
    const applyScopes = () => {
      // Disable all scopes except global (and optionally root)
      previousScopesRef.current.forEach(s => {
        if (s !== HOTKEY_SCOPES.GLOBAL) {
          if (rootScopeDisabled || s !== HOTKEY_SCOPES.ROOT) {
            disableScope(s)
          }
        }
      })

      // Enable our scope
      enableScope(scope)
    }

    applyScopes()

    // Cleanup
    return () => {
      // Use setTimeout to handle React's unmount order
      setTimeout(() => {
        if (entryIdRef.current) {
          scopeManager.remove(entryIdRef.current)

          // Disable our scope
          disableScope(scope)

          // Restore previous scopes
          previousScopesRef.current.forEach(s => {
            if (s !== scope) {
              // Don't re-enable if it was in previous
              enableScope(s)
            }
          })
        }
      }, 0)
    }
  }, [isActive, scope, rootScopeDisabled, componentName, enableScope, disableScope])

  return <>{children}</>
}
