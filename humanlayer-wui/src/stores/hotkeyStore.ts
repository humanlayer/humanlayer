import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { HOTKEY_DEFINITIONS, HotkeyId } from '@/config/hotkeys'

interface HotkeyState {
  // Custom key bindings (only stores overrides from defaults)
  customBindings: Partial<Record<HotkeyId, string>>

  // Get the effective key binding for a hotkey
  getBinding: (id: HotkeyId) => string

  // Set a custom binding
  setBinding: (id: HotkeyId, keys: string) => void

  // Reset a single binding to default
  resetBinding: (id: HotkeyId) => void

  // Reset all bindings to defaults
  resetAllBindings: () => void

  // Check if a key combo conflicts with existing bindings in the same scope
  checkConflict: (keys: string, excludeId?: HotkeyId) => HotkeyId | null
}

// Normalize key string for comparison
function normalizeKeyString(key: string): string {
  return key
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/cmd/g, 'meta')
    .replace(/command/g, 'meta')
    .replace(/option/g, 'alt')
}

// Check if two scopes can conflict (same or overlapping)
function scopesCanConflict(scope1: string | string[], scope2: string | string[]): boolean {
  const scopes1 = Array.isArray(scope1) ? scope1 : [scope1]
  const scopes2 = Array.isArray(scope2) ? scope2 : [scope2]

  for (const s1 of scopes1) {
    for (const s2 of scopes2) {
      // Global scope conflicts with everything
      if (s1 === '*' || s2 === '*') return true
      // Root scope conflicts with other root scopes
      if (s1 === '.' && s2 === '.') return true
      // Same scope conflicts
      if (s1 === s2) return true
      // Parent/child scopes can conflict
      if (s1.startsWith(s2 + '.') || s2.startsWith(s1 + '.')) return true
    }
  }
  return false
}

export const useHotkeyStore = create<HotkeyState>()(
  devtools(
    persist(
      (set, get) => ({
        customBindings: {},

        getBinding: (id: HotkeyId) => {
          const custom = get().customBindings[id]
          return custom ?? HOTKEY_DEFINITIONS[id]?.defaultKey ?? ''
        },

        setBinding: (id: HotkeyId, keys: string) => {
          const defaultKey = HOTKEY_DEFINITIONS[id]?.defaultKey
          // If setting back to default, remove the custom binding
          if (keys === defaultKey) {
            set(state => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { [id]: _removed, ...rest } = state.customBindings
              return { customBindings: rest }
            })
          } else {
            set(state => ({
              customBindings: {
                ...state.customBindings,
                [id]: keys,
              },
            }))
          }
        },

        resetBinding: (id: HotkeyId) => {
          set(state => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [id]: _removed, ...rest } = state.customBindings
            return { customBindings: rest }
          })
        },

        resetAllBindings: () => {
          set({ customBindings: {} })
        },

        checkConflict: (keys: string, excludeId?: HotkeyId) => {
          const normalizedKeys = keys
            .split(',')
            .map(normalizeKeyString)
            .filter(k => k.length > 0)

          if (normalizedKeys.length === 0) return null

          // Get the scope of the key being checked
          const excludeScope = excludeId ? HOTKEY_DEFINITIONS[excludeId]?.scope : '*'

          for (const [id, def] of Object.entries(HOTKEY_DEFINITIONS)) {
            if (id === excludeId) continue

            // Only check conflict if scopes can conflict
            if (!scopesCanConflict(def.scope, excludeScope)) continue

            const binding = get().getBinding(id as HotkeyId)
            const bindingKeys = binding
              .split(',')
              .map(normalizeKeyString)
              .filter(k => k.length > 0)

            // Check if any key in the new binding conflicts
            for (const key of normalizedKeys) {
              if (bindingKeys.includes(key)) {
                return id as HotkeyId
              }
            }
          }

          return null
        },
      }),
      {
        name: 'humanlayer-hotkeys',
      },
    ),
    {
      name: 'hotkey-store',
    },
  ),
)
