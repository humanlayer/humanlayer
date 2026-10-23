import {
	parseTaskDiffFileBaselineRow,
	parseTaskDiffFileVersionRow,
	type TaskDiffFileBaselineRowType,
	type TaskDiffFileVersionRowType,
} from '@humanlayer/streams/diff'
import { useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { type TaskDiffProtocolState, useTaskDiffDatabases } from '@/components/diffs/task-diff-context'

export interface TaskDiffVersionsResult {
	/** Task-start bodies keyed by `fileKey`. */
	baselines: ReadonlyMap<string, TaskDiffFileBaselineRowType>
	/** Every retained body keyed by `versionId`. */
	versions: ReadonlyMap<string, TaskDiffFileVersionRowType>
	status: 'loading' | 'ready' | 'unavailable'
	error: Error | null
	protocol: TaskDiffProtocolState
}

const EMPTY_BASELINES: ReadonlyMap<string, TaskDiffFileBaselineRowType> = new Map()
const EMPTY_VERSIONS: ReadonlyMap<string, TaskDiffFileVersionRowType> = new Map()

/** Reads decoded baselines and versions once the versions stream has replayed. */
export function useTaskDiffVersions(
	taskId: string | null | undefined,
	organizationId: string | null | undefined,
): TaskDiffVersionsResult {
	const { databases, protocol, versionsStatus, versionsError } = useTaskDiffDatabases()
	const versionsDatabase = versionsStatus === 'ready' ? databases.versions : null
	const { data: baselineRows } = useLiveQuery(
		(q) => (versionsDatabase ? q.from({ baselines: versionsDatabase.collections.baselines }) : undefined),
		[versionsDatabase],
	)
	const { data: versionRows } = useLiveQuery(
		(q) => (versionsDatabase ? q.from({ versions: versionsDatabase.collections.versions }) : undefined),
		[versionsDatabase],
	)
	const baselines = useMemo(
		() =>
			baselineRows
				? new Map(baselineRows.map((row) => [row.id, parseTaskDiffFileBaselineRow(row)] as const))
				: EMPTY_BASELINES,
		[baselineRows],
	)
	const versions = useMemo(
		() =>
			versionRows
				? new Map(versionRows.map((row) => [row.id, parseTaskDiffFileVersionRow(row)] as const))
				: EMPTY_VERSIONS,
		[versionRows],
	)

	if (!taskId || !organizationId) {
		return { baselines: EMPTY_BASELINES, versions: EMPTY_VERSIONS, status: 'unavailable', error: null, protocol }
	}
	if (versionsStatus === 'unavailable') {
		return {
			baselines: EMPTY_BASELINES,
			versions: EMPTY_VERSIONS,
			status: 'unavailable',
			error: versionsError,
			protocol,
		}
	}
	if (!versionsDatabase) {
		return { baselines: EMPTY_BASELINES, versions: EMPTY_VERSIONS, status: 'loading', error: null, protocol }
	}
	return { baselines, versions, status: 'ready', error: null, protocol }
}
