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
  const hasCleanedUpRef = useRef(false)

  useEffect(() => {
    if (!isActive) {
      console.log(`[HOTKEY-DEBUG] Skip inactive: scope=${scope} component=${componentName}`)
      return
    }

    // Reset cleanup flag
    hasCleanedUpRef.current = false

    // Generate unique ID for this boundary instance
    const mountId = nanoid()
    entryIdRef.current = mountId

    console.log(
      `[HOTKEY-DEBUG] Boundary mount: scope=${scope} component=${componentName} rootDisabled=${rootScopeDisabled}`,
    )

    // Push to stack
    scopeManager.push({
      id: mountId,
      scope,
      rootDisabled: rootScopeDisabled,
      timestamp: Date.now(),
      component: componentName,
    })

    // Capture current active scopes before we change them
    const currentActive = [...activeScopes]
    previousScopesRef.current = currentActive
    console.log(`[HOTKEY-DEBUG] Active scopes before: [${currentActive.join(', ')}]`)

    // SIMPLIFIED APPROACH:
    // 1. Disable only the currently active scopes (except global)
    // 2. Enable our scope
    // 3. Enable root if not disabled

    // Step 1: Disable currently active scopes except global
    currentActive.forEach(s => {
      if (s !== HOTKEY_SCOPES.GLOBAL) {
        if (s === HOTKEY_SCOPES.ROOT && !rootScopeDisabled) {
          // Keep root enabled if this boundary doesn't disable it
          return
        }
        console.log(`[HOTKEY-DEBUG] Disabling active scope: ${s}`)
        disableScope(s)
      }
    })

    // Step 2: Enable our scope
    console.log(`[HOTKEY-DEBUG] Enabling scope: ${scope}`)
    enableScope(scope)

    // Step 3: Ensure root is enabled if not disabled
    if (!rootScopeDisabled && !currentActive.includes(HOTKEY_SCOPES.ROOT)) {
      console.log(`[HOTKEY-DEBUG] Enabling root scope`)
      enableScope(HOTKEY_SCOPES.ROOT)
    }

    // Cleanup
    return () => {
      // Prevent double cleanup in StrictMode
      if (hasCleanedUpRef.current) {
        console.log(`[HOTKEY-DEBUG] Cleanup already run, skipping: scope=${scope}`)
        return
      }
      hasCleanedUpRef.current = true

      const cleanupId = entryIdRef.current
      console.log(
        `[HOTKEY-DEBUG] Cleanup start: scope=${scope} component=${componentName} id=${cleanupId}`,
      )

      // Use setTimeout to handle React's unmount order
      setTimeout(() => {
        // Remove from stack
        if (cleanupId) {
          scopeManager.remove(cleanupId)
        }

        // Disable our scope
        console.log(`[HOTKEY-DEBUG] Disabling scope: ${scope}`)
        disableScope(scope)

        // Find what should be active now
        const stack = scopeManager.getStack()
        console.log(`[HOTKEY-DEBUG] Stack after cleanup: [${stack.map(e => e.scope).join(', ')}]`)

        if (stack.length > 0) {
          const newTop = stack[stack.length - 1]

          // Enable the new top scope
          console.log(`[HOTKEY-DEBUG] Restoring scope: ${newTop.scope}`)
          enableScope(newTop.scope)

          // Enable root if not disabled by new top
          if (!newTop.rootDisabled) {
            console.log(`[HOTKEY-DEBUG] Restoring root scope`)
            enableScope(HOTKEY_SCOPES.ROOT)
          }
        } else {
          // Stack empty, restore to initial state
          console.log(`[HOTKEY-DEBUG] Stack empty, restoring initial scopes`)
          enableScope(HOTKEY_SCOPES.ROOT)
          // Sessions scope is handled by SessionTable boundary
        }
      }, 0)
    }
  }, [isActive, scope, rootScopeDisabled, componentName, enableScope, disableScope])
  // Note: activeScopes intentionally captured at mount time only

  return <>{children}</>
}
