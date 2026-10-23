import { beforeAll } from 'vitest'

import { requireExternalTestServices } from './external-test-services'

beforeAll(async () => {
	await requireExternalTestServices()
}, 15_000)
