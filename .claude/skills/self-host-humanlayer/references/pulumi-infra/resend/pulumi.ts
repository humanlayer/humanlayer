import * as resend from '@humanlayer/pulumi-resend'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import { createOnboardingAutomation } from './onboarding-automation'
import { createOnboardingTemplates } from './onboarding-templates'

const config = new pulumi.Config()
const resendApiKey = config.requireSecret('apiKey')
const sendingDomainName = 'PLACEHOLDER_SENDING_DOMAIN_PLACEHOLDER'
const dnsZone = sendingDomainName.split('.').slice(1).join('.')

const zone = await aws.route53.getZone({ name: dnsZone, privateZone: false })

const provider = new resend.Provider(
	'resend-provider',
	{
		apiKey: resendApiKey,
	},
	{ pluginDownloadURL: 'github://api.github.com/humanlayer/pulumi-resend' },
)

const sendingDomain = new resend.Domain(
	'sending-domain',
	{
		name: sendingDomainName,
		clickTracking: true,
		openTracking: false,
		trackingSubdomain: 'go',
	},
	{ provider },
)

const productUsersSegment = resend.Segment.get('users-segment', '3ef07dc9-0556-4eea-b2d9-85efa710c3d2', { provider })

const adminsSegment = new resend.Segment(
	'admins-segment',
	{
		name: 'admins',
	},
	{ provider },
)

const onboardingContactProperties = {
	workosUserId: new resend.ContactProperty(
		'onboarding-workos-user-id',
		{ key: 'workos_user_id', type: 'string' },
		{ provider },
	),
	enrolledAt: new resend.ContactProperty(
		'onboarding-enrolled-at',
		{ key: 'onboarding__enrolled_at', type: 'string' },
		{ provider },
	),
	sequence: new resend.ContactProperty(
		'onboarding-sequence',
		{ key: 'onboarding__sequence', type: 'string' },
		{ provider },
	),
	disabled: new resend.ContactProperty(
		'onboarding-disabled',
		{ key: 'onboarding__disabled', type: 'string', fallbackValue: '0' },
		{ provider },
	),
	isAdmin: new resend.ContactProperty(
		'onboarding-is-admin',
		{ key: 'onboarding__is_admin', type: 'string', fallbackValue: '0' },
		{ provider },
	),
	// Day-1 slot milestones (PR Milestone 3). Write-once "1" flags patched by the
	// API; the Automation reads them at send time to choose the slot-1 variant.
	rpiTaskCreated: new resend.ContactProperty(
		'onboarding-rpi-task-created',
		{ key: 'onboarding__rpi_task_created', type: 'string', fallbackValue: '0' },
		{ provider },
	),
	trackerConnected: new resend.ContactProperty(
		'onboarding-tracker-connected',
		{ key: 'onboarding__tracker_connected', type: 'string', fallbackValue: '0' },
		{ provider },
	),
	// Lite-sequence core-aha milestones (PR Milestone 4). Day-3 design-doc slot and
	// day-5 inbound-comment slot read these write-once "1" flags at send time.
	designDocIterated: new resend.ContactProperty(
		'onboarding-design-doc-iterated',
		{ key: 'onboarding__design_doc_iterated', type: 'string', fallbackValue: '0' },
		{ provider },
	),
	designDocInboundCommentReceived: new resend.ContactProperty(
		'onboarding-design-doc-inbound-comment-received',
		{ key: 'onboarding__design_doc_inbound_comment_received', type: 'string', fallbackValue: '0' },
		{ provider },
	),
	designDocInboundCommentResolved: new resend.ContactProperty(
		'onboarding-design-doc-inbound-comment-resolved',
		{ key: 'onboarding__design_doc_inbound_comment_resolved', type: 'string', fallbackValue: '0' },
		{ provider },
	),
}

const onboardingTemplates = createOnboardingTemplates({ provider })
const onboardingAutomation = createOnboardingAutomation({ provider, templates: onboardingTemplates })

const records = sendingDomain.records
const dmarcPolicy = 'v=DMARC1; p=none; rua=mailto:PLACEHOLDER_DMARC_REPORT_EMAIL_PLACEHOLDER'

const route53Records = records.apply((records) =>
	records
		// The tracking CNAME is explicit below and the parent zone's CAA set already permits amazon.com.
		.filter((record) => record.record !== 'Tracking' && record.type !== 'CAA')
		.map(
			(record, index) =>
				new aws.route53.Record(
					`resend-domain-${record.record.toLowerCase()}-${record.type.toLowerCase()}-${index}`,
					{
						zoneId: zone.zoneId,
						name: record.name,
						type: record.type,
						ttl: 300,
						records: [record.value],
						allowOverwrite: true,
					},
				),
		),
)

const clickTrackingRecord = new aws.route53.Record(
	'resend-click-tracking-cname',
	{
		zoneId: zone.zoneId,
		name: `go.${sendingDomainName}`,
		type: 'CNAME',
		ttl: 300,
		records: ['links1.resend-dns.com'],
		allowOverwrite: true,
	},
	{ dependsOn: sendingDomain },
)

const dmarcRecord = new aws.route53.Record('resend-domain-dmarc-txt', {
	zoneId: zone.zoneId,
	name: `_dmarc.${sendingDomainName}`,
	type: 'TXT',
	ttl: 300,
	records: [dmarcPolicy],
	allowOverwrite: true,
})

const domainVerification = new resend.DomainVerification(
	'sending-domain-verification',
	{
		domainId: sendingDomain.id,
	},
	{
		provider,
		dependsOn: route53Records.apply((records) => [...records, dmarcRecord, clickTrackingRecord]),
	},
)

export const domainId = sendingDomain.id
export const domainName = sendingDomain.name
export const domainStatus = sendingDomain.status
export const domainVerificationId = domainVerification.id
export const domainVerificationStatus = domainVerification.status
export const domainDnsRecords = sendingDomain.records
export const dmarcRecordFqdn = dmarcRecord.fqdn
export const dmarcRecordValue = dmarcPolicy
export const clickTrackingRecordFqdn = clickTrackingRecord.fqdn
export const route53RecordFqdns = pulumi
	.all([route53Records, dmarcRecord.fqdn, clickTrackingRecord.fqdn])
	.apply(([records, dmarcFqdn, clickTrackingFqdn]) => [
		...records.map((record) => record.fqdn),
		dmarcFqdn,
		clickTrackingFqdn,
	])
export const manualSetupChecklist = pulumi
	.all([sendingDomain.name, sendingDomain.records, dmarcRecord.fqdn, clickTrackingRecord.fqdn])
	.apply(([name, records, dmarcFqdn, clickTrackingFqdn]) => ({
		domain: name,
		steps: [
			'Route53 records are generated directly from the Resend domain records output.',
			`Click tracking is managed as ${clickTrackingFqdn} with CNAME target links1.resend-dns.com.`,
			`DMARC is managed as ${dmarcFqdn} with policy ${dmarcPolicy}.`,
			'Confirm click-tracking verification in Resend after this stack applies.',
		],
		records,
		dmarc: {
			fqdn: dmarcFqdn,
			value: dmarcPolicy,
		},
	}))
export const usersSegmentId = productUsersSegment.id
export const productUsersSegmentId = productUsersSegment.id
export const adminsSegmentId = adminsSegment.id
export const onboardingContactPropertyIds = Object.fromEntries(
	Object.entries(onboardingContactProperties).map(([key, property]) => [key, property.id]),
)
export const onboardingWelcomeTemplateId = onboardingTemplates.welcome.id
export const onboardingRpiTaskDefaultTemplateId = onboardingTemplates.rpiTaskDefault.id
export const onboardingRpiTaskTrackerVariantTemplateId = onboardingTemplates.rpiTaskTrackerVariant.id
export const onboardingDesignDocDefaultTemplateId = onboardingTemplates.designDocDefault.id
export const onboardingDesignDocDoneAdminTemplateId = onboardingTemplates.designDocDoneAdmin.id
export const onboardingDesignDocDoneNonAdminTemplateId = onboardingTemplates.designDocDoneNonAdmin.id
export const onboardingDesignCommentDefaultTemplateId = onboardingTemplates.designCommentDefault.id
export const onboardingDesignCommentUnresolvedTemplateId = onboardingTemplates.designCommentUnresolvedVariant.id
export const onboardingStartedEventId = onboardingAutomation.startedEvent.id
export const onboardingAutomationId = onboardingAutomation.automation.id
