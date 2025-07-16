import { create, StoreApi } from 'zustand'
import { devtools } from 'zustand/middleware'
import { SessionSlice, createSessionSlice } from './slices/sessionSlice'
import { LauncherSlice, createLauncherSlice } from './slices/launcherSlice'
import { ThemeSlice, createThemeSlice } from './slices/themeSlice'
import { AppSlice, createAppSlice } from './slices/appSlice'

// Combined store type that includes all slices
export type ComposedDemoStore = SessionSlice & LauncherSlice & ThemeSlice & AppSlice

// Animation step interface updated for slice-based state
export interface DemoAnimationStep {
  // Each property is optional - only specify what changes
  sessionState?: Partial<SessionSlice>
  launcherState?: Partial<LauncherSlice>
  themeState?: Partial<ThemeSlice>
  appState?: Partial<AppSlice>
  delay: number
  description?: string
}

// Create the composed demo store
export const createComposedDemoStore = (): StoreApi<ComposedDemoStore> => {
  return create<ComposedDemoStore>()(
    devtools(
      (...args) => ({
        ...createSessionSlice(...args),
        ...createLauncherSlice(...args),
        ...createThemeSlice(...args),
        ...createAppSlice(...args),
      }),
      { 
        name: 'composed-demo-store',
        enabled: process.env.NODE_ENV === 'development'
      }
    )
  )
}

// Demo animator for slice-based state
export class ComposedDemoAnimator {
  private store: StoreApi<ComposedDemoStore>
  private sequence: DemoAnimationStep[]
  private currentIndex: number = 0
  private timeoutId: NodeJS.Timeout | null = null
  private isRunning: boolean = false

  constructor(store: StoreApi<ComposedDemoStore>, sequence: DemoAnimationStep[]) {
    this.store = store
    this.sequence = sequence
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
  }

  pause() {
    this.isRunning = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  resume() {
    if (!this.isRunning && this.currentIndex < this.sequence.length) {
      this.isRunning = true
      this.playNext()
    }
  }

  reset() {
    this.stop()
    this.currentIndex = 0
  }

  private playNext() {
    if (!this.isRunning || this.currentIndex >= this.sequence.length) {
      if (this.isRunning) {
        // Loop back to beginning
        this.currentIndex = 0
        this.playNext()
      }
      return
    }

    const step = this.sequence[this.currentIndex]
    
    this.timeoutId = setTimeout(() => {
      console.log(`[Demo Animator] Step ${this.currentIndex + 1}/${this.sequence.length}: ${step.description || 'State update'}`)
      
      // Build the complete state update object
      const updates: any = {}
      
      // Merge all state slices
      if (step.sessionState) {
        Object.assign(updates, step.sessionState)
      }
      if (step.launcherState) {
        Object.assign(updates, step.launcherState)
      }
      if (step.themeState) {
        Object.assign(updates, step.themeState)
      }
      if (step.appState) {
        Object.assign(updates, step.appState)
      }
      
      // Apply the state update
      this.store.setState(updates)
      
      // For theme changes, we need to call setTheme to trigger side effects
      if (step.themeState?.theme) {
        this.store.getState().setTheme(step.themeState.theme)
      }
      
      this.currentIndex++
      this.playNext()
    }, step.delay)
  }

  getCurrentStep(): number {
    return this.currentIndex
  }

  getTotalSteps(): number {
    return this.sequence.length
  }

  getProgress(): number {
    return this.sequence.length > 0 ? (this.currentIndex / this.sequence.length) * 100 : 0
  }
}