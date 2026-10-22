import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const permissionsPolicy = [
	'camera=()',
	'microphone=()',
	'geolocation=()',
	'payment=()',
	'usb=()',
	'serial=()',
	'hid=()',
	'bluetooth=()',
	'accelerometer=()',
	'gyroscope=()',
	'magnetometer=()',
	'display-capture=()',
	'xr-spatial-tracking=()',
	'fullscreen=(self)',
	'autoplay=(self)',
	'clipboard-read=(self)',
	'clipboard-write=(self)',
	'publickey-credentials-get=(self)',
].join(', ')

export interface SpaSecurityHeadersPolicyArgs {
	apiOrigin: pulumi.Input<string>
	syncOrigin: pulumi.Input<string>
	/** Where the app sends Sentry events, e.g. `https://o123.ingest.us.sentry.io`. Omit when Sentry is off. */
	sentryIngestOrigin?: string
	additionalConnectSrc?: pulumi.Input<string>[]
}

export function createSpaSecurityHeadersPolicy(
	name: string,
	args: SpaSecurityHeadersPolicyArgs,
): aws.cloudfront.ResponseHeadersPolicy {
	const additionalConnectSrc = args.additionalConnectSrc ?? []
	const sentryConnectSrc: string[] = []
	if (args.sentryIngestOrigin) sentryConnectSrc.push(args.sentryIngestOrigin)
	const cspReportOnly = pulumi
		.all([args.apiOrigin, args.syncOrigin, ...additionalConnectSrc])
		.apply(([apiOrigin, syncOrigin, ...additionalConnectOrigins]) =>
			[
				"default-src 'self'",
				"script-src 'self'",
				"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
				"font-src 'self' data: https://fonts.gstatic.com",
				"img-src 'self' data: blob: https:",
				[
					"connect-src 'self'",
					apiOrigin,
					syncOrigin,
					'https://api.workos.com',
					'https://*.authkit.app',
					...sentryConnectSrc,
					'https://*.s3.us-east-1.amazonaws.com',
					'https://s3.us-east-1.amazonaws.com',
					'https://*.s3.amazonaws.com',
					'https://s3.amazonaws.com',
					...additionalConnectOrigins,
				].join(' '),
				"frame-src 'self' blob: https://*.s3.us-east-1.amazonaws.com https://s3.us-east-1.amazonaws.com https://*.s3.amazonaws.com https://s3.amazonaws.com",
				"worker-src 'self' blob:",
				"media-src 'self' data: blob:",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self' https://api.workos.com https://*.authkit.app",
				"frame-ancestors 'self'",
				'upgrade-insecure-requests',
			]
				.map((directive) => `${directive};`)
				.join(' '),
		)

	return new aws.cloudfront.ResponseHeadersPolicy(name, {
		name,
		securityHeadersConfig: {
			contentTypeOptions: {
				override: true,
			},
			frameOptions: {
				frameOption: 'SAMEORIGIN',
				override: true,
			},
			referrerPolicy: {
				referrerPolicy: 'strict-origin-when-cross-origin',
				override: true,
			},
			strictTransportSecurity: {
				accessControlMaxAgeSec: 63072000,
				includeSubdomains: true,
				preload: true,
				override: true,
			},
		},
		customHeadersConfig: {
			items: [
				{
					header: 'Permissions-Policy',
					value: permissionsPolicy,
					override: true,
				},
				{
					header: 'Content-Security-Policy-Report-Only',
					value: cspReportOnly,
					override: true,
				},
			],
		},
	})
}
