import type {
	UserContextShardRow,
	UserContextShardState,
} from '@humanlayer/riptide-api-contract/api/context-shards/list'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/orpc/client'

import { ContextShardsTable } from './ContextShardsTable'

interface ContextShardsListData {
	data: UserContextShardRow[]
}

export function ContextShardsPanel() {
	const { queryClient: api } = useRiptideApi()
	const { organizationId } = useAuth()
	const queryClient = useQueryClient()

	const list = useQuery(
		api.contextShards.list.queryOptions({
			input: {},
			enabled: !!organizationId,
			refetchInterval: 30_000,
		}),
	)
	const listQueryKey = api.contextShards.list.key()
	const optimisticallySetState = async (shardId: string, state: UserContextShardState) => {
		await queryClient.cancelQueries({ queryKey: listQueryKey })
		const previous = queryClient.getQueryData<ContextShardsListData>(listQueryKey)
		queryClient.setQueryData<ContextShardsListData>(listQueryKey, (current) =>
			current
				? {
						...current,
						data: current.data
							.map((shard) => (shard.id === shardId ? { ...shard, state } : shard))
							.sort(
								(left, right) =>
									Number(left.state === 'dismissed') - Number(right.state === 'dismissed'),
							),
					}
				: current,
		)
		return previous
	}
	const restoreList = (previous?: ContextShardsListData) => {
		if (previous) queryClient.setQueryData(listQueryKey, previous)
	}
	const invalidateList = () => queryClient.invalidateQueries({ queryKey: listQueryKey })
	const updatePreference = useMutation(
		api.contextShards.updatePreference.mutationOptions({
			onMutate: ({ shardId, shardState }) => optimisticallySetState(shardId, shardState),
			onError: (_error, _variables, previous) => {
				restoreList(previous)
				toast.error('Failed to update context shard')
			},
			onSettled: invalidateList,
		}),
	)
	const restore = useMutation(
		api.contextShards.restore.mutationOptions({
			onMutate: ({ shardId }) => optimisticallySetState(shardId, 'disabled'),
			onError: (_error, _variables, previous) => {
				restoreList(previous)
				toast.error('Failed to restore context shard')
			},
			onSettled: invalidateList,
		}),
	)
	const pendingShardId = updatePreference.isPending
		? updatePreference.variables?.shardId
		: restore.isPending
			? restore.variables?.shardId
			: null

	return (
		<div className="h-full overflow-y-auto p-3 sm:p-6">
			<div className="mx-auto max-w-5xl">
				<div className="mb-5">
					<h1 className="text-lg font-semibold">Context Shards</h1>
					<p className="mt-1 text-xs text-muted-foreground">
						Your organization&apos;s shared agent memory. Choose which shards apply to every new session you
						launch.
					</p>
				</div>
				{list.isPending ? (
					<div className="border border-dashed border-border p-6 text-sm text-muted-foreground">
						Loading context shards...
					</div>
				) : list.isError ? (
					<div className="border border-destructive/50 p-6 text-sm text-destructive">
						Failed to load context shards.
					</div>
				) : (
					<ContextShardsTable
						rows={list.data.data}
						pendingShardId={pendingShardId}
						onAlwaysOnChange={(shardId, enabled) =>
							updatePreference.mutate({ shardId, shardState: enabled ? 'enabled' : 'disabled' })
						}
						onDismiss={(shardId) => updatePreference.mutate({ shardId, shardState: 'dismissed' })}
						onRestore={(shardId) => restore.mutate({ shardId })}
					/>
				)}
			</div>
		</div>
	)
}
