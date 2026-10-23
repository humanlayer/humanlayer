export interface ScopeEntry {
	id: string
	scope: string
	rootDisabled: boolean
	timestamp: number
	component?: string
}

class ScopeManager {
	private stack: ScopeEntry[] = []
	private listeners = new Set<(stack: ScopeEntry[]) => void>()
	private rootDisabledCount = 0

	push(entry: ScopeEntry): void {
		this.stack.push(entry)
		if (entry.rootDisabled) {
			this.rootDisabledCount++
		}
		this.notifyListeners()
	}

	remove(id: string): void {
		const index = this.stack.findIndex((e) => e.id === id)
		if (index !== -1) {
			const removed = this.stack[index]
			this.stack.splice(index, 1)
			if (removed !== undefined && removed.rootDisabled) {
				this.rootDisabledCount = Math.max(0, this.rootDisabledCount - 1)
			}
			this.notifyListeners()
		}
	}

	getActiveScope(): string | null {
		const top = this.stack[this.stack.length - 1]
		return top ? top.scope : null
	}

	getStack(): ScopeEntry[] {
		return [...this.stack]
	}

	shouldRootBeEnabled(): boolean {
		return this.rootDisabledCount === 0
	}

	subscribe(listener: (stack: ScopeEntry[]) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private notifyListeners(): void {
		this.listeners.forEach((listener) => listener(this.stack))
	}
}

export const scopeManager = new ScopeManager()
