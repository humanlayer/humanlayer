import { DAEMON_ACTIVE_SESSION_STATUSES, type SessionStatus } from '@humanlayer/db/tables/sessions'

/**
 * Session statuses that indicate the session is actively running or waiting,
 * i.e. the daemon process may still be alive.
 */
export const ACTIVE_SESSION_STATUSES: SessionStatus[] = [...DAEMON_ACTIVE_SESSION_STATUSES]

const ACTIVE_SESSION_STATUS_SET = new Set<string>(ACTIVE_SESSION_STATUSES)

export const isSessionActive = (status: SessionStatus): boolean => ACTIVE_SESSION_STATUS_SET.has(status)
