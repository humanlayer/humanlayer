import * as Effect from 'effect/Effect'

import { ElectronPlatform } from '../../platform/electron-platform.service'

export const getAppVersionHandler = Effect.fn('rpc.get_app_version')(function* () {
	const platform = yield* ElectronPlatform
	return platform.version
})
