/// <reference lib="dom" />
import React, { forwardRef, useImperativeHandle } from 'react'
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { render, screen, waitFor } from '@testing-library/react'

const draftInputFocus = mock(() => {})
const mockTrackEvent = mock(() => {})
const mockRefreshSessions = mock(() => Promise.resolve())

mock.module('lucide-react', () => ({
  FolderOpen: () => null,
  TextSearch: () => null,
}))

mock.module('react-router-dom', () => ({
  useNavigate: () => mock(() => {}),
  useSearchParams: () => [new URLSearchParams()],
}))

mock.module('react-hotkeys-hook', () => ({
  useHotkeys: mock(() => {}),
}))

mock.module('sonner', () => ({
  toast: {
    error: mock(() => {}),
    success: mock(() => {}),
  },
}))

mock.module('@/AppStore', () => {
  const useStore = (selector: (state: any) => unknown) =>
    selector({
      responseEditor: null,
      refreshSessions: mockRefreshSessions,
    })

  useStore.getState = () => ({
    responseEditor: {
      getText: () => '',
    },
  })

  return { useStore }
})

mock.module('@/hooks/usePostHogTracking', () => ({
  usePostHogTracking: () => ({
    trackEvent: mockTrackEvent,
  }),
}))

mock.module('@/hooks/useLocalStorage', () => ({
  useLocalStorage: (_key: string, initialValue: unknown) => [initialValue, mock(() => {}), true],
}))

mock.module('@/hooks/useRecentPaths', () => ({
  useRecentPaths: () => ({
    paths: [],
  }),
}))

mock.module('@/lib/daemon', () => ({
  daemonClient: {
    launchSession: mock(() => Promise.resolve({ sessionId: 'draft-1' })),
    updateSession: mock(() => Promise.resolve()),
    deleteSession: mock(() => Promise.resolve()),
    getDirectoryInfo: mock(() => Promise.resolve({})),
  },
}))

mock.module('@/lib/logging', () => ({
  logger: {
    log: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}))

mock.module('@/utils/errors', () => ({
  formatError: (error: unknown) => String(error),
}))

mock.module('@/components/FuzzySearchInput', () => ({
  SearchInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

mock.module('@/components/HotkeyScopeBoundary', () => ({
  HotkeyScopeBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

mock.module('@/components/ui/input', () => ({
  Input: forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
    <input ref={ref} {...props} />
  )),
}))

mock.module('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}))

mock.module('../DangerouslySkipPermissionsDialog', () => ({
  DangerouslySkipPermissionsDialog: () => null,
}))

mock.module('./CreateDirectoryDialog', () => ({
  CreateDirectoryDialog: () => null,
}))

mock.module('./DiscardDraftDialog', () => ({
  DiscardDraftDialog: () => null,
}))

mock.module('./DraftLauncherInput', () => ({
  DraftLauncherInput: forwardRef((_props: unknown, ref: React.ForwardedRef<{ focus: () => void }>) => {
    useImperativeHandle(ref, () => ({
      focus: draftInputFocus,
    }))

    return <div data-testid="draft-launcher-input" />
  }),
}))

import { SessionStatus } from '@/lib/daemon/types'
import { createMockSession } from '@/test-utils'
import { DraftLauncherForm } from './DraftLauncherForm'

describe('DraftLauncherForm autofocus', () => {
  beforeEach(() => {
    draftInputFocus.mockReset()
    mockTrackEvent.mockReset()
    mockRefreshSessions.mockReset()
  })

  test('focuses the draft input for a new draft', async () => {
    render(<DraftLauncherForm session={null} />)

    await waitFor(() => {
      expect(draftInputFocus).toHaveBeenCalledTimes(1)
    })
  })

  test('falls back to the title field for an existing titled draft', async () => {
    const session = createMockSession({
      status: SessionStatus.Draft,
      title: 'Existing draft',
      summary: 'Existing draft',
    })

    render(<DraftLauncherForm session={session} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Describe this session...')).toHaveFocus()
    })
    expect(draftInputFocus).not.toHaveBeenCalled()
  })
})
