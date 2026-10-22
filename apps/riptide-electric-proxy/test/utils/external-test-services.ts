import {
	getExternalTestServicesConfig,
	verifyExternalTestServices,
} from '@humanlayer/test-fixtures/external-test-services'

let verificationPromise: Promise<void> | undefined

export async function requireExternalTestServices(): Promise<void> {
	if (!verificationPromise) {
		verificationPromise = verifyExternalTestServices(getExternalTestServicesConfig()).catch((error) => {
			verificationPromise = undefined
			throw error
		})
	}

	try {
		await verificationPromise
	} catch (error) {
		process.exitCode = 1
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(message)
	}
}
