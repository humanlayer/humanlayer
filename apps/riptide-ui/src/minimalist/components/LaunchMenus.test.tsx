import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostView } from '@/minimalist/lib/data'

import { TargetMenu } from './LaunchMenus'

const { useProjects, useRecentDirectories, navigate } = vi.hoisted(() => ({
	useProjects: vi.fn(),
	useRecentDirectories: vi.fn(),
	navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/minimalist/lib/data', () => ({ useHosts: vi.fn(), useProjects, useRecentDirectories }))
vi.mock('@/minimalist/components/Menu', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/components/Menu')>()),
	Menu: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}))

const host = { host: { host_id: 'vm' }, name: 'vm', online: true } as unknown as HostView

beforeEach(() => {
	vi.clearAllMocks()
	useProjects.mockReturnValue({ data: [{ id: 'project', name: 'HumanLayer', repositories: [] }] })
	useRecentDirectories.mockReturnValue(['/home/me/notes', '/home/me/site'])
})

function renderMenu(target: Parameters<typeof TargetMenu>[0]['target'] = null) {
	const onPick = vi.fn()
	const onClose = vi.fn()
	const props = { anchor: { current: null }, onClose, host, target, onPick }
	const view = render(<TargetMenu open {...props} />)
	return { onPick, onClose, view, props }
}

describe('the new-task target menu', () => {
	it("lists projects, then the host's recent directories, and picks one", () => {
		const { onPick, onClose } = renderMenu({ kind: 'directory', path: '/home/me/site' })
		expect(screen.getByText('Projects')).toBeInTheDocument()
		expect(screen.getByText('Directories on vm')).toBeInTheDocument()
		expect(useRecentDirectories).toHaveBeenCalledWith('vm')
		expect(screen.getByRole('button', { name: /^site/ })).toHaveTextContent('✓')
		expect(screen.getByRole('button', { name: /^notes/ })).not.toHaveTextContent('✓')
		fireEvent.click(screen.getByRole('button', { name: /^notes/ }))
		expect(onPick).toHaveBeenCalledWith({ kind: 'directory', path: '/home/me/notes' })
		expect(onClose).toHaveBeenCalled()
	})

	it('picks a typed path and keeps a half-typed one while closed', () => {
		const { onPick, view, props } = renderMenu()
		fireEvent.change(screen.getByRole('textbox', { name: 'Directory path' }), { target: { value: '~/half' } })
		view.rerender(<TargetMenu open={false} {...props} />)
		view.rerender(<TargetMenu open {...props} />)
		const path = screen.getByRole('textbox', { name: 'Directory path' })
		expect(path).toHaveValue('~/half')
		fireEvent.change(path, { target: { value: ' ~/code/app ' } })
		fireEvent.click(screen.getByRole('button', { name: 'Use directory' }))
		expect(onPick).toHaveBeenCalledWith({ kind: 'directory', path: '~/code/app' })
		expect(screen.getByRole('textbox', { name: 'Directory path' })).toHaveValue('')
	})
})
