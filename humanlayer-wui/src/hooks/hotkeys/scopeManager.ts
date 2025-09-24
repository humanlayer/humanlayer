// Debugging logger
const DEBUG = import.meta.env.DEV;

interface ScopeEntry {
  id: string;
  scope: string;
  rootDisabled: boolean;
  timestamp: number;
  component?: string; // For debugging
}

class ScopeManager {
  private stack: ScopeEntry[] = [];
  private listeners = new Set<(stack: ScopeEntry[]) => void>();

  // Debug logging
  private logChange(action: string, entry: ScopeEntry, stackBefore: ScopeEntry[], stackAfter: ScopeEntry[]) {
    if (!DEBUG) return;

    console.group(`🎹 HotkeyScope ${action}: ${entry.scope}`);
    console.log('Component:', entry.component || 'Unknown');
    console.log('Stack Before:', stackBefore.map(e => e.scope));
    console.log('Stack After:', stackAfter.map(e => e.scope));
    console.log('Active Scope:', this.getActiveScope());
    console.table(stackAfter);
    console.groupEnd();
  }

  push(entry: ScopeEntry): void {
    const stackBefore = [...this.stack];
    this.stack.push(entry);
    this.logChange('PUSH', entry, stackBefore, this.stack);
    this.notifyListeners();
  }

  remove(id: string): void {
    const stackBefore = [...this.stack];
    const index = this.stack.findIndex(e => e.id === id);
    if (index !== -1) {
      const removed = this.stack[index];
      this.stack.splice(index, 1);
      this.logChange('REMOVE', removed, stackBefore, this.stack);
      this.notifyListeners();
    }
  }

  getActiveScope(): string | null {
    return this.stack.length > 0
      ? this.stack[this.stack.length - 1].scope
      : null;
  }

  getStack(): ScopeEntry[] {
    return [...this.stack];
  }

  subscribe(listener: (stack: ScopeEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.stack));
  }
}

export const scopeManager = new ScopeManager();