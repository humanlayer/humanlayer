import * as aws from '@pulumi/aws'
import { local } from '@pulumi/command'
import * as pulumi from '@pulumi/pulumi'

export interface StaticSiteAssetsArgs {
	bucketName: pulumi.Input<string>
	build: pulumi.Resource
	deploymentId: string
	path: string
}

export class StaticSiteAssets extends pulumi.ComponentResource {
	readonly syncCommand: local.Command

	constructor(name: string, args: StaticSiteAssetsArgs, opts?: pulumi.ComponentResourceOptions) {
		super(
			'codelayer:static-site:Assets',
			name,
			{},
			pulumi.mergeOptions(opts, { aliases: [{ type: 'synced-folder:index:S3BucketFolder' }] }),
		)

		const region = aws.getRegionOutput().name
		const sync = pulumi.interpolate`test -s "${args.path}/index.html" && aws s3 sync "${args.path}" "s3://${args.bucketName}" --acl "private" --region "${region}" --delete --only-show-errors`
		this.syncCommand = new local.Command(
			`${name}-sync-command`,
			{
				create: sync,
				update: sync,
				environment: { PULUMI_ASSET_DEPLOYMENT: args.deploymentId },
			},
			{ dependsOn: [args.build], parent: this, retainOnDelete: true },
		)

		this.registerOutputs({ syncCommand: this.syncCommand })
	}
}
