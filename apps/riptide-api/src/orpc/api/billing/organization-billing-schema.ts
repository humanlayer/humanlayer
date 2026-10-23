import { Sentry } from '../../../instrument'
import logger from '../../../logger'

export function captureInvalidBillingOrganizationRow(input: { organizationId: string; parseIssues: unknown }): void {
	logger.error(input, 'Selected organization billing row failed schema validation')
	Sentry.captureException(new Error('Selected organization billing row failed schema validation'), {
		tags: { error_type: 'billing_org_schema_validation_failed' },
		extra: input,
	})
}
