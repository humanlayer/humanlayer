import React, { useEffect, useState, createContext, useContext } from 'react'
import { create, StoreApi, useStore } from 'zustand'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { logger } from '@/lib/logging'

// Define the store interface
interface CounterStore {
  count: number
  increment: () => void
  decrement: () => void
  reset: () => void
}

// Animation step for demo sequences
interface AnimationStep {
  state: Partial<CounterStore>
  delay: number // milliseconds to wait before applying this state
}

// Store factory that creates a counter store
function createCounterStore(isDemo: boolean = false): StoreApi<CounterStore> {
  return create<CounterStore>(set => ({
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

// Demo animator that plays through a sequence of states
class DemoAnimator {
  private store: StoreApi<CounterStore>
  private sequence: AnimationStep[]
  private currentIndex: number = 0
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private isRunning: boolean = false
  private unsubscribe: (() => void) | null = null

  constructor(store: StoreApi<CounterStore>, sequence: AnimationStep[]) {
    this.store = store
    this.sequence = sequence

    // Subscribe to store changes for logging/debugging
    this.unsubscribe = store.subscribe(state => {
      logger.log('[Demo Store] Count updated to:', state.count)
    })
  }

  start() {
    this.isRunning = true
    this.currentIndex = 0
    this.playNext()
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

  private playNext() {
    if (!this.isRunning || this.currentIndex >= this.sequence.length) {
      // Loop back to start
      if (this.isRunning) {
        this.currentIndex = 0
        this.playNext()
      }
      return
    }

    const step = this.sequence[this.currentIndex]

    this.timeoutId = setTimeout(() => {
      // Apply the state from the sequence
      this.store.setState(step.state as CounterStore)

      // Move to next step
      this.currentIndex++
      this.playNext()
    }, step.delay)
  }
}

// Single context for counter store (no need to specify if it's demo or real)
const CounterStoreContext = createContext<StoreApi<CounterStore> | null>(null)

// Hook to use the counter store
function useCounterStore<T>(selector: (state: CounterStore) => T): T {
  const store = useContext(CounterStoreContext)
  if (!store) throw new Error('useCounterStore must be used within a CounterStoreProvider')
  return useStore(store, selector)
}

// Provider for real store
function RealStoreProvider({ children }: { children: React.ReactNode }) {
  const [realStore] = useState(() => createCounterStore(false))

  useEffect(() => {
    // Optional: Subscribe to real store for logging
    const unsubscribe = realStore.subscribe(state => {
      logger.log('[Real Store] Count updated to:', state.count)
    })

    return () => {
      unsubscribe()
      realStore.setState({ count: 0 })
    }
  }, [realStore])

  return <CounterStoreContext.Provider value={realStore}>{children}</CounterStoreContext.Provider>
}

// Provider for demo store with animation sequence
interface DemoStoreProviderProps {
  children: React.ReactNode
  sequence: AnimationStep[]
}

function DemoStoreProvider({ children, sequence }: DemoStoreProviderProps) {
  const [demoStore] = useState(() => createCounterStore(true))
  const [animator] = useState(() => new DemoAnimator(demoStore, sequence))

  useEffect(() => {
    // Start animation
    animator.start()

    return () => {
      animator.stop()
      demoStore.setState({ count: 0 })
    }
  }, [animator, demoStore])

  return <CounterStoreContext.Provider value={demoStore}>{children}</CounterStoreContext.Provider>
}

// Counter component - doesn't know or care if it's real or demo!
function Counter() {
  const count = useCounterStore(state => state.count)
  const increment = useCounterStore(state => state.increment)
  const decrement = useCounterStore(state => state.decrement)
  const reset = useCounterStore(state => state.reset)

  return (
    <Card className="w-[400px]">
      <CardHeader>
        <CardTitle>Counter</CardTitle>
        <CardDescription>Click the buttons to interact</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-6xl font-bold tabular-nums">{count}</div>
          </div>

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
        </div>
      </CardContent>
    </Card>
  )
}

// Wrapper to show demo vs real labeling (for demo purposes only)
function LabeledCounter({ label, variant }: { label: string; variant: 'default' | 'secondary' }) {
  return (
    <div className="space-y-2">
      <Badge variant={variant} className="text-sm">
        {label}
      </Badge>
      <Counter />
    </div>
  )
}

// Example demo sequences
const simpleCountingSequence: AnimationStep[] = [
  { state: { count: 0 }, delay: 1000 },
  { state: { count: 1 }, delay: 2000 },
  { state: { count: 2 }, delay: 1500 },
  { state: { count: 3 }, delay: 3000 },
  { state: { count: 4 }, delay: 1000 },
  { state: { count: 5 }, delay: 2500 },
  { state: { count: 0 }, delay: 4000 }, // Reset after pause
]

const randomSequence: AnimationStep[] = [
  { state: { count: 0 }, delay: 1000 },
  { state: { count: 7 }, delay: 2000 },
  { state: { count: 3 }, delay: 1500 },
  { state: { count: 11 }, delay: 2200 },
  { state: { count: 8 }, delay: 1800 },
  { state: { count: 15 }, delay: 3000 },
  { state: { count: 2 }, delay: 1200 },
  { state: { count: 0 }, delay: 3500 },
]

// Main demo page
export default function StoreDemo() {
  const [sequenceType, setSequenceType] = useState<'simple' | 'random'>('simple')
  const sequence = sequenceType === 'simple' ? simpleCountingSequence : randomSequence

  return (
    <div className="container mx-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Zustand Store Demo</h1>
          <p className="text-muted-foreground">
            The Counter component doesn't know if it's using a real or demo store
          </p>
        </div>

        <div className="flex justify-center gap-4">
          <Button
            onClick={() => setSequenceType('simple')}
            variant={sequenceType === 'simple' ? 'default' : 'outline'}
            size="sm"
          >
            Simple Sequence
          </Button>
          <Button
            onClick={() => setSequenceType('random')}
            variant={sequenceType === 'random' ? 'default' : 'outline'}
            size="sm"
          >
            Random Sequence
          </Button>
        </div>

        <div className="grid gap-8 md:grid-cols-2 justify-items-center">
          <RealStoreProvider>
            <LabeledCounter label="Real Store (Interactive)" variant="default" />
          </RealStoreProvider>

          <DemoStoreProvider sequence={sequence} key={sequenceType}>
            <LabeledCounter label="Demo Store (Automated)" variant="secondary" />
          </DemoStoreProvider>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Animation Sequence</CardTitle>
            <CardDescription>
              Current sequence: {sequenceType === 'simple' ? 'Simple counting' : 'Random jumps'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
              {JSON.stringify(sequence, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Key Architecture Points</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-1">Component Design:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>The Counter component has no knowledge of demo vs real mode</li>
                <li>It simply uses the store provided by its parent context</li>
                <li>All components should be written this way - pure consumers of store state</li>
                <li>The provider determines behavior, not the component</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-1">Demo Store Features:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Accepts a JSON sequence of states and delays</li>
                <li>Plays through the sequence automatically</li>
                <li>Loops back to start when sequence completes</li>
                <li>Can load sequences from JSON files for marketing demos</li>
                <li>Easily create different scenarios for different pages</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-1">Benefits:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Components remain pure and testable</li>
                <li>Demo sequences are data, not code</li>
                <li>Marketing team can modify sequences without coding</li>
                <li>Same components work in app and marketing site</li>
                <li>Easy to A/B test different animation sequences</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
