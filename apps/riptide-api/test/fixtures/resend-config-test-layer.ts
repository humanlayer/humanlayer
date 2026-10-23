import { Layer, Redacted } from 'effect'

import { ResendConfig, type ResendConfigShape } from '../../src/effects/services/resend/resend-config.service'

export const ResendConfigTest = (config: Partial<ResendConfigShape> = {}) =>
	Layer.succeed(ResendConfig, {
		apiKey: Redacted.make('re_test_key'),
		apiBaseUrl: 'https://resend.example.test',
		fromEmail: 'test@example.com',
		cloudOrigin: 'https://cloud.example.com',
		appOrigin: 'https://app.example.com',
		...config,
	})
