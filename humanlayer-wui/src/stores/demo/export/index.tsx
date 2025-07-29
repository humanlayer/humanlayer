/**
 * WUI Demo Store Export Package
 *
 * This module provides a simplified API for marketing teams to create
 * product demonstrations and capture screenshots.
 */

import React from 'react'
import { DemoStoreProvider as Provider, useDemoStore } from '../providers/DemoStoreProvider'
import {
  launcherWorkflowSequence as launcherSeq,
  statusChangesSequence as statusSeq,
  themeShowcaseSequence as themeSeq,
} from '../animations/sequences'
import type { ComposedDemoStore as DemoStore } from '../composedDemoStore'
import type { DemoAnimationStep as AnimationStep } from '../composedDemoStore'
import { SessionStatus } from '@/lib/daemon/types'
import type { Session } from '@/lib/daemon/types'

// Re-export core functionality
export { Provider as DemoStoreProvider, useDemoStore }
export type { DemoStore as ComposedDemoStore }

// Export pre-built animation sequences
export {
  launcherSeq as launcherWorkflowSequence,
  statusSeq as statusChangesSequence,
  themeSeq as themeShowcaseSequence,
}

// Export types for custom sequences
export type { AnimationStep as DemoAnimationStep }

// Export utilities
export { SessionStatus }

export function createMockSession(
  id: string,
  query: string,
  status: SessionStatus = SessionStatus.Running,
  overrides: Partial<Session> = {},
): Session {
  const now = new Date()
  return {
    id,
    runId: `run-${id}`,
    claudeSessionId: status !== SessionStatus.Starting ? `claude-${id}` : undefined,
    status,
    createdAt: now,
    lastActivityAt: now,
    query,
    summary: query,
    model: 'claude-3-5-sonnet-20241022',
    workingDir: '/home/user/project',
    autoAcceptEdits: false,
    ...overrides,
  }
}

// Pre-configured demo wrapper component

interface QuickDemoProps {
  sequence?: 'launcher' | 'status' | 'themes'
  children: React.ReactNode
}

export function QuickDemo({ sequence = 'launcher', children }: QuickDemoProps) {
  const sequences = {
    launcher: launcherSeq,
    status: statusSeq,
    themes: themeSeq,
  }

  return <Provider sequence={sequences[sequence]}>{children}</Provider>
}

// Utility to create custom animation sequences
interface SequenceBuilder {
  steps: AnimationStep[]
  addStep(step: AnimationStep): SequenceBuilder
  addDelay(ms: number): SequenceBuilder
  addSessions(sessions: Session[]): SequenceBuilder
  openLauncher(mode?: 'command' | 'search'): SequenceBuilder
  closeLauncher(): SequenceBuilder
  setTheme(theme: string): SequenceBuilder
  showApproval(id: string, title: string): SequenceBuilder
  build(): AnimationStep[]
}

export function createSequence(): SequenceBuilder {
  const steps: AnimationStep[] = []

  const builder: SequenceBuilder = {
    steps,

    addStep(step: AnimationStep) {
      steps.push(step)
      return builder
    },

    addDelay(ms: number) {
      if (steps.length > 0) {
        steps[steps.length - 1].delay = ms
      }
      return builder
    },

    addSessions(sessions: Session[]) {
      steps.push({
        sessionState: { sessions },
        delay: 2000,
        description: `Add ${sessions.length} sessions`,
      })
      return builder
    },

    openLauncher(mode: 'command' | 'search' = 'command') {
      steps.push({
        launcherState: { isOpen: true, mode },
        delay: 1500,
        description: `Open launcher in ${mode} mode`,
      })
      return builder
    },

    closeLauncher() {
      steps.push({
        launcherState: { isOpen: false },
        delay: 1000,
        description: 'Close launcher',
      })
      return builder
    },

    setTheme(theme: string) {
      steps.push({
        themeState: { theme: theme as any },
        delay: 1000,
        description: `Switch to ${theme} theme`,
      })
      return builder
    },

    showApproval(id: string, title: string) {
      steps.push({
        appState: {
          approvals: [
            {
              id,
              title,
              status: 'pending',
            },
          ],
        },
        delay: 2000,
        description: `Show approval: ${title}`,
      })
      return builder
    },

    build() {
      return steps
    },
  }

  return builder
}

// Example usage for marketing team
export const exampleCustomSequence = createSequence()
  .addSessions([])
  .addDelay(1000)
  .openLauncher('command')
  .addDelay(2000)
  .addSessions([
    createMockSession('1', 'Build new feature', SessionStatus.Running),
    createMockSession('2', 'Fix bug', SessionStatus.WaitingInput),
  ])
  .closeLauncher()
  .addDelay(3000)
  .showApproval('approval-1', 'Deploy to production?')
  .addDelay(3000)
  .setTheme('framer-dark')
  .build()
