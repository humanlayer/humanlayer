import { ORPCError } from '@orpc/client'
import { describe, expect, test } from 'vitest'

import type { SidebarProject, WorkspaceStatus } from '@/components/project-sidebar/derive-project-sidebar'
import {
	readProjectMetadata,
	readWorkspace,
	workspaceRefetchInterval,
} from '@/components/project-sidebar/project-sidebar-reads'

const project: SidebarProject = {
	id: 'p',
	name: 'Project',
	organizationId: 'org',
	description: null,
	private: false,
	createdBy: 'me',
	resourceOwnerUserId: 'me',
	repositories: [],
	archived: false,
	createdAt: 1,
	updatedAt: 1,
}
const status: WorkspaceStatus = { workspace: { projectId: 'p' } as WorkspaceStatus['workspace'], materializations: [] }

describe('authoritative sidebar read states', () => {
	test('pending/error is not absence; cached data survives refetch failures', () => {
		expect(readWorkspace(undefined)).toEqual({ state: 'pending' })
		expect(readWorkspace({ error: new Error('offline') })).toEqual({ state: 'error' })
		expect(readWorkspace({ error: new ORPCError('NOT_FOUND', { defined: true }) })).toEqual({ state: 'missing' })
		expect(readWorkspace({ data: status, error: new Error('offline') })).toEqual({ state: 'ready', data: status })
	})

	test('both active and archived metadata reads gate unresolved classification; archive transitions deduplicate by newest revision', () => {
		expect(readProjectMetadata({ data: { projects: [project] }, error: null }, { error: null }).projectsState).toBe(
			'pending',
		)
		expect(readProjectMetadata({ error: new Error('offline') }, { error: null }).projectsState).toBe('error')
		const result = readProjectMetadata(
			{ data: { projects: [project] }, error: null },
			{ data: { projects: [{ ...project, archived: true, updatedAt: 2 }] }, error: null },
		)
		expect(result.projectsState).toBe('ready')
		expect(result.projects).toEqual([{ ...project, archived: true, updatedAt: 2 }])
	})

	test('polls pending launches and running workspace setup, not completed history or failed setup', () => {
		expect(workspaceRefetchInterval(false, status)).toBe(false)
		expect(workspaceRefetchInterval(true, status)).toBe(5000)
		const settingUp = {
			...status,
			materializations: [
				{ repositories: [{ status: { status: 'materializing', error: null } }] },
			] as WorkspaceStatus['materializations'],
		}
		expect(workspaceRefetchInterval(false, settingUp)).toBe(5000)
	})
})
