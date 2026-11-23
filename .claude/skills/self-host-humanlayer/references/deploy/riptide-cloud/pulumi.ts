import { execSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSpaSecurityHeadersPolicy } from '@humanlayer/pulumi-helpers/cloudfront'
import { denyInsecureTransportStatement } from '@humanlayer/pulumi-helpers/s3'
import { StaticSiteAssets } from '@humanlayer/pulumi-helpers/static-site-assets'
import * as aws from '@pulumi/aws'
import { local } from '@pulumi/command'
import * as pulumi from '@pulumi/pulumi'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuration
const config = new pulumi.Config()
const workosClientId = config.require('workosClientId')
const sentryEnvironment = config.require('sentryEnvironment')
const sentryDsn = config.require('sentryDsn')
const sentryAuthToken = config.requireSecret('sentryAuthToken')
const blockNewOrgCreation = config.getBoolean('blockNewOrgCreation') ?? false

const env = pulumi.getStack()

const gitSha = process.env.HUMANLAYER_SHA ?? execSync('git rev-parse HEAD', { cwd: '../../humanlayer' }).toString().trim()
const deploymentId = Date.now().toString()

// Stack references
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const riptideApiStack = new pulumi.StackReference(`humanlayer/riptide-api/${env}`)
const electricProxyStack = new pulumi.StackReference(`humanlayer/riptide-electric-proxy/${env}`)
const stripeStack = new pulumi.StackReference(`humanlayer/stripe/${env}`)

// Import from core stack
const validatedCertificateArn = coreStack.requireOutput('validatedCertificateArn') as pulumi.Output<string>
const hostedZoneId = coreStack.requireOutput('hostedZoneId') as pulumi.Output<string>
const domainSuffix = coreStack.requireOutput('domainSuffix') as pulumi.Output<string>

/**
 * Origin of the riptide-ui web app, for links out of this app to a task's real
 * page.
 *
 * DERIVED from core's `domainSuffix`, not read off the riptide-ui stack. The
 * two apps deploy as SIBLINGS (both `needs: [riptide-api,
 * riptide-electric-proxy]`), so a StackReference on riptide-ui would add an
 * ordering dependency this graph does not have and would fail outright on a
 * first deploy into a fresh environment. riptide-ui builds its own `appUrl`
 * from the same core output with the same expression, so both sides read one
 * source of truth and cannot drift.
 */
const appOrigin = pulumi.interpolate`https://app.${domainSuffix}`

// Import from downstream stacks
const apiUrl = riptideApiStack.requireOutput('serviceUrl') as pulumi.Output<string>
const syncOrigin = electricProxyStack.requireOutput('serviceUrl') as pulumi.Output<string>
const billingEnforcementEnabled = stripeStack.requireOutput('billingEnforcementEnabled') as pulumi.Output<boolean>

// --- Vite Build ---
const viteBuild = new local.Command('vite-build', {
	create: 'bun run build',
	dir: '.',
	environment: pulumi
		.all([apiUrl, syncOrigin, appOrigin, billingEnforcementEnabled, gitSha, sentryAuthToken])
		.apply(([apiUrlVal, syncOriginVal, appOriginVal, billingEnforcementEnabledVal, sha, authToken]) => {
			const environment = {
				VITE_PUBLIC_RIPTIDE_API_ORIGIN: apiUrlVal,
				VITE_PUBLIC_SYNC_ORIGIN: syncOriginVal,
				VITE_PUBLIC_APP_ORIGIN: appOriginVal,
				VITE_PUBLIC_WORKOS_CLIENT_ID: workosClientId,
				VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED: String(billingEnforcementEnabledVal),
				VITE_PUBLIC_BLOCK_NEW_ORG_CREATION: String(blockNewOrgCreation),
				VITE_PUBLIC_ENVIRONMENT: env,
				VITE_PUBLIC_BUILD_VERSION: sha.trim(),
				VITE_PUBLIC_SENTRY_DSN: sentryDsn,
				VITE_PUBLIC_SENTRY_ENVIRONMENT: sentryEnvironment,
				NODE_ENV: 'production',
				// vite build with Sentry sourcemaps exceeds Node's default heap
				NODE_OPTIONS: '--max-old-space-size=8192',
				// Sentry sourcemap upload
				SENTRY_ORG: 'humanlayer-00',
				SENTRY_PROJECT: 'riptide-cloud',
			}
			const sentryAuthentication = authToken ? { SENTRY_AUTH_TOKEN: authToken } : {}
			return { ...environment, ...sentryAuthentication }
		}),
	triggers: [apiUrl, syncOrigin, appOrigin, billingEnforcementEnabled, workosClientId, deploymentId],
})

// --- S3 Bucket (private, no public access) ---
const siteBucket = new aws.s3.Bucket('riptide-cloud-bucket', {
	forceDestroy: true,
})

const _bucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock('riptide-cloud-public-access-block', {
	bucket: siteBucket.id,
	blockPublicAcls: true,
	blockPublicPolicy: true,
	ignorePublicAcls: true,
	restrictPublicBuckets: true,
})

// --- CloudFront Origin Access Control ---
const oac = new aws.cloudfront.OriginAccessControl('riptide-cloud-oac', {
	name: `riptide-cloud-${env}`,
	originAccessControlOriginType: 's3',
	signingBehavior: 'always',
	signingProtocol: 'sigv4',
})

const securityHeadersPolicy = createSpaSecurityHeadersPolicy(`riptide-cloud-security-headers-${env}`, {
	apiOrigin: apiUrl,
	syncOrigin,
	sentryIngestOrigin: new URL(sentryDsn).origin,
})

// --- CloudFront Distribution ---
const distribution = new aws.cloudfront.Distribution(
	'riptide-cloud-cdn',
	{
		enabled: true,
		defaultRootObject: 'index.html',
		waitForDeployment: true,
		aliases: [pulumi.interpolate`cloud.${domainSuffix}`],
		origins: [
			{
				originId: 'S3Origin',
				domainName: siteBucket.bucketRegionalDomainName,
				originAccessControlId: oac.id,
			},
		],
		defaultCacheBehavior: {
			targetOriginId: 'S3Origin',
			viewerProtocolPolicy: 'redirect-to-https',
			responseHeadersPolicyId: securityHeadersPolicy.id,
			allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
			cachedMethods: ['GET', 'HEAD'],
			forwardedValues: {
				queryString: false,
				cookies: { forward: 'none' },
			},
			compress: true,
			minTtl: 0,
			defaultTtl: 86400,
			maxTtl: 31536000,
		},
		customErrorResponses: [
			{
				errorCode: 403,
				responseCode: 200,
				responsePagePath: '/index.html',
				errorCachingMinTtl: 10,
			},
			{
				errorCode: 404,
				responseCode: 200,
				responsePagePath: '/index.html',
				errorCachingMinTtl: 10,
			},
		],
		viewerCertificate: {
			acmCertificateArn: validatedCertificateArn,
			sslSupportMethod: 'sni-only',
			minimumProtocolVersion: 'TLSv1.2_2021',
		},
		restrictions: {
			geoRestriction: {
				restrictionType: 'none',
			},
		},
		priceClass: 'PriceClass_100',
	},
	{ dependsOn: [siteBucket] },
)

// --- S3 Bucket Policy: Allow CloudFront OAC access ---
const _bucketPolicy = new aws.s3.BucketPolicy('riptide-cloud-bucket-policy', {
	bucket: siteBucket.id,
	policy: pulumi.all([siteBucket.arn, distribution.arn]).apply(([bucketArn, distArn]) =>
		JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'AllowCloudFrontServicePrincipalReadOnly',
					Effect: 'Allow',
					Principal: {
						Service: 'cloudfront.amazonaws.com',
					},
					Action: 's3:GetObject',
					Resource: `${bucketArn}/*`,
					Condition: {
						StringEquals: {
							'AWS:SourceArn': distArn,
						},
					},
				},
				denyInsecureTransportStatement(bucketArn),
			],
		}),
	),
})

// --- Route53 A-alias: cloud.{domainSuffix} → CloudFront ---
const _dnsRecord = new aws.route53.Record('riptide-cloud-dns', {
	zoneId: hostedZoneId,
	name: pulumi.interpolate`cloud.${domainSuffix}`,
	type: 'A',
	aliases: [
		{
			name: distribution.domainName,
			zoneId: distribution.hostedZoneId,
			evaluateTargetHealth: false,
		},
	],
})

// --- S3 Object Upload ---
const siteAssets = new StaticSiteAssets(
	'riptide-cloud-assets',
	{
		build: viteBuild,
		deploymentId,
		path: path.resolve(__dirname, '../../humanlayer/apps/riptide-cloud/dist'),
		bucketName: siteBucket.bucket,
	},
	{ parent: siteBucket },
)

// --- CloudFront Cache Invalidation after deploy ---
const _invalidation = new local.Command(
	'riptide-cloud-invalidation',
	{
		create: pulumi.interpolate`aws cloudfront create-invalidation --distribution-id ${distribution.id} --paths "/*"`,
		triggers: [viteBuild.stdout],
	},
	{ dependsOn: [distribution, siteAssets.syncCommand] },
)

// --- Sentry Release Creation ---
const _sentryRelease = new local.Command(
	'sentry-release',
	{
		create: sentryAuthToken.apply(() => {
			const version = gitSha
			return [
				`sentry-cli releases new "${version}" --org humanlayer-00 --project riptide-cloud`,
				`sentry-cli releases set-commits --auto --ignore-missing "${version}" --org humanlayer-00`,
				`sentry-cli releases deploys "${version}" new -e "${sentryEnvironment}" --org humanlayer-00`,
				`sentry-cli releases finalize "${version}" --org humanlayer-00`,
			].join(' && ')
		}),
		environment: sentryAuthToken.apply((token) => ({
			SENTRY_AUTH_TOKEN: token,
		})),
		triggers: [gitSha],
	},
	{ dependsOn: [_invalidation] },
)

// --- Exports ---
export const cloudUrl = pulumi.interpolate`https://cloud.${domainSuffix}`
export const distributionId = distribution.id
