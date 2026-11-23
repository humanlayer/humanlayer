import type { Session } from '@humanlayer/db/tables/sessions'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MinimalistPortalContext } from '@/minimalist/lib/portal'

import { SessionRowMenu } from './TaskNavMenus'

// jsdom has no modal dialogs; the menu only needs them to open.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
	this.open = true
}
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
	this.open = false
}

const copy = vi.fn()
vi.mock('@/minimalist/lib/use-copy', () => ({ useCopy: () => copy }))
vi.mock('@/minimalist/lib/use-archive', () => ({ useArchive: () => ({ pending: false, archive: vi.fn() }) }))
vi.mock('@/minimalist/lib/access', () => ({ useSessionAccess: () => ({ canManageSession: false }) }))
vi.mock('@/hooks/stores/settingsStore', () => ({
	useSettingsStore: (pick: (state: unknown) => unknown) =>
		pick({ orgSettings: { multiplayerPromptingEnabled: false } }),
}))
vi.mock('@/hooks/stores/unreadStore', () => ({
	useUnreadStore: Object.assign((pick: (state: unknown) => unknown) => pick({ unreadSessionIds: new Set() }), {
		getState: () => ({ markRead: vi.fn(), markUnread: vi.fn() }),
	}),
}))

afterEach(() => {
	cleanup()
	copy.mockClear()
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

const session = { id: 'session-1', archived: false } as unknown as Session

function openMenu() {
	const anchor = createRef<HTMLElement>()
	render(
		<MinimalistPortalContext value={document.body}>
			<SessionRowMenu anchor={anchor} session={session} selected onClose={vi.fn()} onDialog={vi.fn()} />
		</MinimalistPortalContext>,
	)
}

describe('SessionRowMenu', () => {
	// In the desktop app the page's origin is tauri://localhost, which nobody else can open.
	it('copies a web link that can hand off to the desktop app, not the page address', () => {
		vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://app.humanlayer.com')
		openMenu()
		fireEvent.click(screen.getByText('Copy link'))
		expect(copy).toHaveBeenCalledWith(
			'https://app.humanlayer.com/sessions/session-1?deep=true',
			'Session link copied',
			expect.any(String),
		)
	})

	it('opens a new window in this app', () => {
		vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://app.humanlayer.com')
		const open = vi.spyOn(window, 'open').mockReturnValue(null)
		openMenu()
		fireEvent.click(screen.getByText('Open in new window'))
		expect(open).toHaveBeenCalledWith(`${window.location.origin}/sessions/session-1`, '_blank', 'noopener')
	})
})
