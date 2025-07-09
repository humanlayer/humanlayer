import { StoreApi } from 'zustand'
import { AppState } from './appStore'

export interface AnimationStep {
  state: Partial<AppState>
  delay: number // milliseconds before applying this state
}

export class DemoAnimator {
  private store: StoreApi<AppState>
  private sequence: AnimationStep[]
  private currentIndex: number = 0
  private timeoutId: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private isPaused: boolean = false

  constructor(store: StoreApi<AppState>, sequence: AnimationStep[]) {
    this.store = store
    this.sequence = sequence
  }

  start() {
    this.isRunning = true
    this.isPaused = false
    this.currentIndex = 0
    this.playNext()
  }

  stop() {
    this.isRunning = false
    this.isPaused = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  pause() {
    this.isPaused = true
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  resume() {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false
      this.playNext()
    }
  }

  reset() {
    this.currentIndex = 0
    if (this.isRunning) {
      this.stop()
      this.start()
    }
  }

  private playNext() {
    if (!this.isRunning || this.isPaused || this.currentIndex >= this.sequence.length) {
      // Loop back to start
      if (this.isRunning && !this.isPaused && this.currentIndex >= this.sequence.length) {
        this.currentIndex = 0
        this.playNext()
      }
      return
    }

    const step = this.sequence[this.currentIndex]

    this.timeoutId = setTimeout(() => {
      // Apply the state from the sequence
      this.store.setState(step.state as AppState)

      // Move to next step
      this.currentIndex++
      this.playNext()
    }, step.delay)
  }
}
