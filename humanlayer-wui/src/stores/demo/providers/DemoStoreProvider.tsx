import React, { createContext, useContext, useState, useEffect } from 'react'
import { StoreApi, useStore } from 'zustand'
import { ComposedDemoStore, createComposedDemoStore, ComposedDemoAnimator, DemoAnimationStep } from '../composedDemoStore'

// Context for demo store
const DemoStoreContext = createContext<StoreApi<ComposedDemoStore> | null>(null)

// Hook to use the demo store
export function useDemoStore<T>(selector: (state: ComposedDemoStore) => T): T {
  const store = useContext(DemoStoreContext)
  if (!store) throw new Error('useDemoStore must be used within DemoStoreProvider')
  return useStore(store, selector)
}

// Provider props
interface DemoStoreProviderProps {
  children: React.ReactNode
  sequence: DemoAnimationStep[]
  autoPlay?: boolean
  loop?: boolean
}

// Demo store provider component
export function DemoStoreProvider({ 
  children, 
  sequence, 
  autoPlay = true,
  loop = true 
}: DemoStoreProviderProps) {
  const [store] = useState(() => createComposedDemoStore())
  const [animator] = useState(() => new ComposedDemoAnimator(store, sequence))
  
  useEffect(() => {
    // Initialize theme from slice
    const theme = store.getState().theme
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
    }
    
    // Start animation if autoPlay is enabled
    if (autoPlay) {
      animator.start()
    }
    
    return () => {
      animator.stop()
    }
  }, [animator, autoPlay, store])
  
  // Expose animator controls via context value (optional)
  const contextValue = store
  
  return (
    <DemoStoreContext.Provider value={contextValue}>
      {children}
    </DemoStoreContext.Provider>
  )
}

// Optional: Hook to access animator controls
export function useDemoAnimator() {
  const store = useContext(DemoStoreContext)
  if (!store) throw new Error('useDemoAnimator must be used within DemoStoreProvider')
  
  // In a real implementation, we'd expose the animator instance
  // For now, return basic controls
  return {
    pause: () => console.log('Pause not implemented'),
    resume: () => console.log('Resume not implemented'),
    reset: () => console.log('Reset not implemented')
  }
}