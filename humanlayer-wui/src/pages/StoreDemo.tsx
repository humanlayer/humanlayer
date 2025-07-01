import { useEffect, useState, createContext, useContext } from 'react'
import { create, StoreApi, useStore } from 'zustand'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// Define the store interface
interface CounterStore {
  count: number
  increment: () => void
  decrement: () => void
  reset: () => void
}

// Store factory that creates a counter store
function createCounterStore(isDemo: boolean = false): StoreApi<CounterStore> {
  return create<CounterStore>((set) => ({
    count: 0,
    increment: () => {
      if (!isDemo) {
        set(state => ({ count: state.count + 1 }))
      }
      // Demo mode: no-op (animations handle updates)
    },
    decrement: () => {
      if (!isDemo) {
        set(state => ({ count: state.count - 1 }))
      }
      // Demo mode: no-op
    },
    reset: () => {
      if (!isDemo) {
        set({ count: 0 })
      }
      // Demo mode: no-op
    },
  }))
}

// Demo animator that updates the store automatically
class DemoAnimator {
  private store: StoreApi<CounterStore>
  private timeoutId: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private unsubscribe: (() => void) | null = null
  
  constructor(store: StoreApi<CounterStore>) {
    this.store = store
    
    // Subscribe to store changes for logging/debugging
    this.unsubscribe = store.subscribe(
      (state) => state.count,
      (count) => {
        console.log('[Demo Store] Count updated to:', count)
      }
    )
  }
  
  start() {
    this.isRunning = true
    this.scheduleNext()
  }
  
  stop() {
    this.isRunning = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    // Clean up subscription
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }
  
  private scheduleNext() {
    if (!this.isRunning) return
    
    // Random delay between 1-10 seconds
    const delay = Math.floor(Math.random() * 9000) + 1000
    
    this.timeoutId = setTimeout(() => {
      // Directly update the store state
      this.store.setState(state => ({ count: state.count + 1 }))
      
      // Schedule next update
      this.scheduleNext()
    }, delay)
  }
}

// Context for real store
const RealStoreContext = createContext<StoreApi<CounterStore> | null>(null)

// Context for demo store
const DemoStoreContext = createContext<StoreApi<CounterStore> | null>(null)

// Provider for real store
function RealStoreProvider({ children }: { children: React.ReactNode }) {
  const [realStore] = useState(() => createCounterStore(false))
  
  useEffect(() => {
    // Optional: Subscribe to real store for logging
    const unsubscribe = realStore.subscribe(
      (state) => state.count,
      (count) => {
        console.log('[Real Store] Count updated to:', count)
      }
    )
    
    return () => {
      unsubscribe()
      realStore.setState({ count: 0 })
    }
  }, [realStore])
  
  return (
    <RealStoreContext.Provider value={realStore}>
      {children}
    </RealStoreContext.Provider>
  )
}

// Provider for demo store
function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [demoStore] = useState(() => createCounterStore(true))
  const [animator] = useState(() => new DemoAnimator(demoStore))
  
  useEffect(() => {
    // Start animation
    animator.start()
    
    return () => {
      animator.stop()
      demoStore.setState({ count: 0 })
    }
  }, [animator, demoStore])
  
  return (
    <DemoStoreContext.Provider value={demoStore}>
      {children}
    </DemoStoreContext.Provider>
  )
}

// Hook to use the real store
function useRealStore<T>(selector: (state: CounterStore) => T): T {
  const store = useContext(RealStoreContext)
  if (!store) throw new Error('useRealStore must be used within RealStoreProvider')
  return useStore(store, selector)
}

// Hook to use the demo store
function useDemoStore<T>(selector: (state: CounterStore) => T): T {
  const store = useContext(DemoStoreContext)
  if (!store) throw new Error('useDemoStore must be used within DemoStoreProvider')
  return useStore(store, selector)
}

// Counter component that can use either store
function Counter({ mode }: { mode: 'real' | 'demo' }) {
  const count = mode === 'real' 
    ? useRealStore(state => state.count)
    : useDemoStore(state => state.count)
    
  const increment = mode === 'real'
    ? useRealStore(state => state.increment)
    : useDemoStore(state => state.increment)
    
  const decrement = mode === 'real'
    ? useRealStore(state => state.decrement)
    : useDemoStore(state => state.decrement)
    
  const reset = mode === 'real'
    ? useRealStore(state => state.reset)
    : useDemoStore(state => state.reset)
  
  return (
    <Card className="w-[400px]">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Counter
          <Badge variant={mode === 'real' ? 'default' : 'secondary'}>
            {mode === 'real' ? 'Real Store' : 'Demo Store'}
          </Badge>
        </CardTitle>
        <CardDescription>
          {mode === 'real' 
            ? 'Interactive counter with manual controls' 
            : 'Auto-incrementing counter (random 1-10s intervals)'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-6xl font-bold tabular-nums">{count}</div>
          </div>
          
          {mode === 'real' && (
            <div className="flex gap-2 justify-center">
              <Button onClick={decrement} variant="outline" size="sm">
                -
              </Button>
              <Button onClick={increment} variant="outline" size="sm">
                +
              </Button>
              <Button onClick={reset} variant="outline" size="sm">
                Reset
              </Button>
            </div>
          )}
          
          {mode === 'demo' && (
            <div className="text-center text-sm text-muted-foreground">
              Watching for updates...
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Main demo page
export default function StoreDemo() {
  return (
    <div className="container mx-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Zustand Store Demo</h1>
          <p className="text-muted-foreground">
            Demonstrating real vs demo store implementations using Zustand with React Context pattern
          </p>
        </div>
        
        <div className="grid gap-8 md:grid-cols-2 justify-items-center">
          <RealStoreProvider>
            <Counter mode="real" />
          </RealStoreProvider>
          
          <DemoStoreProvider>
            <Counter mode="demo" />
          </DemoStoreProvider>
        </div>
        
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-1">Real Store:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Created in React state within RealStoreProvider</li>
                <li>User interactions directly update the store state</li>
                <li>Actions modify state using set() function</li>
                <li>Each instance is independent and non-global</li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold mb-1">Demo Store:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Created in React state within DemoStoreProvider</li>
                <li>Same store interface but actions are no-ops in demo mode</li>
                <li>DemoAnimator class controls state updates externally</li>
                <li>Uses store.setState() to update from outside React</li>
                <li>Random intervals between 1-10 seconds for realistic feel</li>
                <li>Proper cleanup on unmount - stops animator and resets state</li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold mb-1">Key Implementation Details:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Both stores use React Context + useState pattern</li>
                <li>No global store instances - everything is scoped to providers</li>
                <li>Same store factory function for both</li>
                <li>Components remain identical regardless of store type</li>
                <li>Animator properly cleans up timeouts on unmount</li>
                <li>Subscriptions demonstrate external state monitoring</li>
                <li>Console logging shows state updates for both stores</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}