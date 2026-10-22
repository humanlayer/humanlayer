import type { Transaction } from '@tanstack/react-db'
import { type UseMutationOptions, useMutation } from '@tanstack/react-query'

export function useOptimisticMutation<TAction extends (...args: never[]) => Transaction>(
	optimisticAction: TAction,
	options?: Omit<UseMutationOptions<Transaction, unknown, Parameters<TAction>[0]>, 'mutationFn'>,
) {
	return useMutation({
		mutationFn: async (vars: Parameters<TAction>[0]) => {
			const tx = optimisticAction(vars)
			await tx.isPersisted.promise
			return tx
		},
		...options,
	})
}
