import * as Effect from 'effect/Effect'

import { HumanLayerCli } from '../../diagnostics/humanlayer-cli.service'

export const updateCliHandler = Effect.fn('rpc.update_cli')(function* () {
	const humanLayerCli = yield* HumanLayerCli
	return yield* humanLayerCli.updateToLatest.pipe(
		Effect.annotateSpans({ rpc_operation: 'UpdateCli' }),
		Effect.annotateLogs({ rpc_operation: 'UpdateCli' }),
	)
})
