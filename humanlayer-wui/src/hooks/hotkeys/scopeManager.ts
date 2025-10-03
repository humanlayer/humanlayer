// Debugging logger
const DEBUG = import.meta.env.DEV

export interface ScopeEntry {
  id: string
  scope: string
  rootDisabled: boolean
  timestamp: number
  component?: string // For debugging
}

class ScopeManager {
  private stack: ScopeEntry[] = []
  private listeners = new Set<(stack: ScopeEntry[]) => void>()

  // Track how many boundaries want root scope disabled
  // When this is 0, root scope should be enabled
  // When this is > 0, root scope should be disabled
  private rootDisabledCount = 0

  // Debug logging
  private logChange(
    action: string,
    entry: ScopeEntry,
    stackBefore: ScopeEntry[],
    stackAfter: ScopeEntry[],
  ) {
    if (!DEBUG) return

    const prefix = '[HOTKEY_SCOPE]'
    console.log(`${prefix} ${action}: ${entry.scope} (${entry.component || 'Unknown'})`)
    console.log(
      `${prefix} Stack: [${stackBefore.map(e => e.scope).join(' → ')}] → [${stackAfter.map(e => e.scope).join(' → ')}]`,
    )
    console.log(
      `${prefix} Active: ${this.getActiveScope() || 'none'}, Root Disabled Count: ${this.rootDisabledCount}`,
    )

    // Extra detailed logging for bypass-related transitions
    if (
      entry.scope.includes('MODAL') ||
      entry.component?.includes('Bypass') ||
      entry.component?.includes('Modal')
    ) {
      console.log(`${prefix} ⚠️ Modal-related transition detected`)
      console.log(`${prefix} Root should be enabled: ${this.shouldRootBeEnabled()}`)
    }

    if (action === 'REMOVE' && entry.scope.includes('MODAL')) {
      console.log(`${prefix} ✅ Modal scope removed, restoring to: ${this.getActiveScope() || 'none'}`)
    }
  }

  push(entry: ScopeEntry): void {
    const stackBefore = [...this.stack]
    this.stack.push(entry)

    // Update root disabled count
    if (entry.rootDisabled) {
      this.rootDisabledCount++
    }

    this.logChange('PUSH', entry, stackBefore, this.stack)
    this.notifyListeners()
  }

  remove(id: string): void {
    const stackBefore = [...this.stack]
    const index = this.stack.findIndex(e => e.id === id)
    if (index !== -1) {
      const removed = this.stack[index]
      this.stack.splice(index, 1)

      // Update root disabled count
      if (removed.rootDisabled) {
        this.rootDisabledCount = Math.max(0, this.rootDisabledCount - 1)
      }

      this.logChange('REMOVE', removed, stackBefore, this.stack)
      this.notifyListeners()
    }
  }

  getActiveScope(): string | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].scope : null
  }

  getStack(): ScopeEntry[] {
    return [...this.stack]
  }

  findEntry(scope: string, component?: string): ScopeEntry | undefined {
    return this.stack.find(e => e.scope === scope && e.component === component)
  }

  shouldRootBeEnabled(): boolean {
    // Root should be enabled when no boundaries have it disabled
    return this.rootDisabledCount === 0
  }

  getRootDisabledCount(): number {
    return this.rootDisabledCount
  }

  // Clean up any orphaned entries with the same scope/component
  // This helps handle React StrictMode double-mounting
  cleanupOrphaned(scope: string, component?: string): void {
    const orphaned = this.stack.filter(e => e.scope === scope && e.component === component)
    // Keep only the most recent entry
    const toRemove = orphaned.slice(0, -1)
    toRemove.forEach(entry => this.remove(entry.id))
  }

  subscribe(listener: (stack: ScopeEntry[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.stack))
  }
}

export const scopeManager = new ScopeManager()
