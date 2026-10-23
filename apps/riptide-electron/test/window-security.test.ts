import { describe, expect, it } from 'vitest'

import { navigationPolicy, rendererPermissionPolicy } from '../src/window/window-security'

describe('Electron renderer navigation policy', () => {
	it('keeps same-origin renderer navigation inside the privileged window', () => {
		expect(navigationPolicy('http://localhost:3000/tasks/one', 'http://localhost:3000/')).toBe('allow')
	})

	it('keeps HTTPS navigation inside one devstack in the privileged window', () => {
		const renderer = 'https://app.electron-wrapper.localhost'
		expect(navigationPolicy('https://cloud.electron-wrapper.localhost/auth/callback', renderer)).toBe('allow')
		expect(navigationPolicy('https://api.electron-wrapper.localhost/health', renderer)).toBe('allow')
	})

	it('does not trust another devstack or a public lookalike domain', () => {
		const renderer = 'https://app.electron-wrapper.localhost'
		expect(navigationPolicy('https://app.other-worktree.localhost', renderer)).toBe('external')
		expect(navigationPolicy('https://app.electron-wrapper.localhost.example.com', renderer)).toBe('external')
	})

	it('allows the hosted WorkOS sign-in flow only for local renderers', () => {
		const localRenderer = 'https://app.electron-wrapper.localhost'
		const packagedRenderer = 'humanlayer-electron-dev://app/'

		expect(navigationPolicy('https://api.workos.com/user_management/authorize?client_id=test', localRenderer)).toBe(
			'allow',
		)
		expect(navigationPolicy('https://tenant.authkit.app/bootstrap', localRenderer)).toBe('allow')
		expect(navigationPolicy('https://api.workos.com/user_management/authenticate', localRenderer)).toBe('external')
		expect(navigationPolicy('https://tenant.authkit.app/bootstrap', packagedRenderer)).toBe('external')
		expect(navigationPolicy('https://authkit.app.example.com', localRenderer)).toBe('external')
	})

	it('scopes the packaged renderer scheme to its own host', () => {
		const packagedRenderer = 'humanlayer-electron-dev://app/'

		expect(navigationPolicy('humanlayer-electron-dev://app/auth/signin', packagedRenderer)).toBe('allow')
		expect(navigationPolicy('humanlayer-electron-dev://oauth/callback?code=x', packagedRenderer)).toBe('deny')
		expect(navigationPolicy('other-scheme://app/', packagedRenderer)).toBe('deny')
	})

	it('routes web destinations externally and denies other protocols', () => {
		const renderer = 'humanlayer-electron-dev://app/'
		expect(navigationPolicy('https://example.com/docs', renderer)).toBe('external')
		expect(navigationPolicy('file:///Users/example/secret.txt', renderer)).toBe('deny')
		expect(navigationPolicy('javascript:alert(1)', renderer)).toBe('deny')
		expect(navigationPolicy('riptide://auth/callback', renderer)).toBe('deny')
	})
})

describe('Electron renderer permission policy', () => {
	it('allows approved permissions from the configured renderer origin', () => {
		const renderer = 'humanlayer-electron-dev://app/'
		const requestingUrl = 'humanlayer-electron-dev://app/tasks/one'
		const allowedPermissions = [
			'clipboard-read',
			'clipboard-sanitized-write',
			'notifications',
			'media',
			'fullscreen',
			'openExternal',
			'persistent-storage',
		]

		for (const permission of allowedPermissions) {
			expect(rendererPermissionPolicy(permission, requestingUrl, renderer)).toBe(true)
		}
	})

	it('denies approved permissions from other origins and unapproved permissions', () => {
		const renderer = 'https://app.electron-wrapper.localhost'
		expect(
			rendererPermissionPolicy(
				'clipboard-sanitized-write',
				'https://api.electron-wrapper.localhost/tasks/one',
				renderer,
			),
		).toBe(false)
		expect(rendererPermissionPolicy('geolocation', renderer, renderer)).toBe(false)
		expect(rendererPermissionPolicy('usb', renderer, renderer)).toBe(false)
	})
})
