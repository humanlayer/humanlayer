import { ConfigProvider } from 'effect'

/** The link origins `AccessRequestServiceLive` reads from config for its admin notification. */
export const AccessRequestLinkOriginsTestConfig = (
	origins: { readonly cloudOrigin?: string; readonly appOrigin?: string } = {},
) =>
	ConfigProvider.layer(
		ConfigProvider.fromUnknown({
			CLOUD_ORIGIN: origins.cloudOrigin ?? 'https://cloud.example.com',
			APP_ORIGIN: origins.appOrigin ?? 'https://app.example.com',
		}),
	)
