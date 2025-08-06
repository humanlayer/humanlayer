import type { Session } from '@/lib/daemon/types'
import { SessionStatus } from '@/lib/daemon/types'

export function createMockSession(overrides: Partial<Session> = {}): Session {
  const id = overrides.id || `session-${Math.random().toString(36).substring(7)}`
  const timestamp = new Date()

  return {
    id,
    runId: `run-${id}`,
    summary: 'Test session',
    query: 'Test query',
    status: SessionStatus.Running,
    workingDir: '/home/user/project',
    model: 'claude-3',
    createdAt: timestamp,
    lastActivityAt: timestamp,
    archived: false,
    autoAcceptEdits: false,
    dangerouslySkipPermissions: false,
    dangerouslySkipPermissionsExpiresAt: undefined,
    ...overrides,
  }
}

export function createMockSessions(count: number, overrides: Partial<Session>[] = []): Session[] {
  return Array.from({ length: count }, (_, index) => {
    const baseTime = new Date('2024-01-01T00:00:00Z')
    baseTime.setMinutes(index * 2)
    const startTime = baseTime.toISOString()
    baseTime.setMinutes(index * 2 + 1)
    const lastActivityTime = baseTime.toISOString()

    return createMockSession({
      id: `session-${index + 1}`,
      summary: `Session ${index + 1}`,
      query: `Test query ${index + 1}`,
      status: index < 2 ? SessionStatus.Running : SessionStatus.Completed,
      workingDir: `/home/user/project${index + 1}`,
      createdAt: new Date(startTime),
      lastActivityAt: new Date(lastActivityTime),
      ...overrides[index],
    })
  })
}
