/**
 * WUI Demo Store Export Package
 *
 * This module provides a simplified API for marketing teams to create
 * product demonstrations and capture screenshots.
 */

// Re-export core functionality from providers
export { DemoStoreProvider, useDemoStore } from '../providers/DemoStoreProvider'
export type { ComposedDemoStore } from '../composedDemoStore'

// Export pre-built animation sequences
export {
  launcherWorkflowSequence,
  statusChangesSequence,
  themeShowcaseSequence,
} from '../animations/sequences'

// Export types for custom sequences
export type { DemoAnimationStep } from '../composedDemoStore'

// Export utilities for creating mock data
import { SessionStatus } from '@/lib/daemon/types'
import type { SessionInfo } from '@/lib/daemon/types'

export { SessionStatus }

export function createMockSession(
  id: string,
  query: string,
  status: SessionStatus = SessionStatus.Running,
  overrides: Partial<SessionInfo> = {},
): SessionInfo {
  const now = new Date()
  return {
    id,
    run_id: `run-${id}`,
    claude_session_id: status !== SessionStatus.Starting ? `claude-${id}` : undefined,
    status,
    start_time: now.toISOString(),
    last_activity_at: now.toISOString(),
    query,
    summary: query,
    model: 'claude-3-5-sonnet-20241022',
    working_dir: '/home/user/project',
    auto_accept_edits: false,
    ...overrides,
  }
}

// Pre-configured demo wrapper component
import React from 'react'

interface QuickDemoProps {
  sequence?: 'launcher' | 'status' | 'themes'
  children: React.ReactNode
}

export function QuickDemo({ sequence = 'launcher', children }: QuickDemoProps) {
  const sequences = {
    launcher: launcherWorkflowSequence,
    status: statusChangesSequence,
    themes: themeShowcaseSequence,
  }

  return <DemoStoreProvider sequence={sequences[sequence]}>{children}</DemoStoreProvider>
}

// Utility to create custom animation sequences
interface SequenceBuilder {
  steps: DemoAnimationStep[]
  addStep(step: DemoAnimationStep): SequenceBuilder
  addDelay(ms: number): SequenceBuilder
  addSessions(sessions: SessionInfo[]): SequenceBuilder
  openLauncher(mode?: 'command' | 'search'): SequenceBuilder
  closeLauncher(): SequenceBuilder
  setTheme(theme: string): SequenceBuilder
  showApproval(id: string, title: string): SequenceBuilder
  build(): DemoAnimationStep[]
}

export function createSequence(): SequenceBuilder {
  const steps: DemoAnimationStep[] = []

  const builder: SequenceBuilder = {
    steps,

    addStep(step: DemoAnimationStep) {
      steps.push(step)
      return builder
    },

    addDelay(ms: number) {
      if (steps.length > 0) {
        steps[steps.length - 1].delay = ms
      }
      return builder
    },

    addSessions(sessions: SessionInfo[]) {
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
