import type { SessionInfo } from '@/lib/daemon/types'
import { SessionStatus } from '@/lib/daemon/types'

export function createMockSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const id = overrides.id || `session-${Math.random().toString(36).substring(7)}`
  const timestamp = new Date().toISOString()

  return {
    id,
    run_id: `run-${id}`,
    summary: 'Test session',
    query: 'Test query',
    status: SessionStatus.Running,
    working_dir: '/home/user/project',
    model: 'claude-3',
    start_time: timestamp,
    last_activity_at: timestamp,
    archived: false,
    auto_accept_edits: false,
    ...overrides,
  }
}

export function createMockSessions(
  count: number,
  overrides: Partial<SessionInfo>[] = [],
): SessionInfo[] {
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
      working_dir: `/home/user/project${index + 1}`,
      start_time: startTime,
      last_activity_at: lastActivityTime,
      ...overrides[index],
    })
  })
}
