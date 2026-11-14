import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const env = pulumi.getStack()

if (!['dev', 'beta', 'prod'].includes(env)) {
	throw new Error(`unsupported rust-durable-streams-registry stack: ${env}`)
}

const repository = new aws.ecr.Repository('rust-durable-streams', {
	name: `rust-durable-streams-${env}`,
	forceDelete: false,
	imageTagMutability: 'IMMUTABLE',
	imageScanningConfiguration: {
		scanOnPush: false,
	},
	encryptionConfigurations: [{ encryptionType: 'AES256' }],
})

new aws.ecr.LifecyclePolicy('rust-durable-streams-lifecycle', {
	repository: repository.name,
	policy: JSON.stringify({
		rules: [
			{
				rulePriority: 1,
				description: 'Expire untagged build artifacts after 30 days',
				selection: {
					tagStatus: 'untagged',
					countType: 'sinceImagePushed',
					countUnit: 'days',
					countNumber: 30,
				},
				action: { type: 'expire' },
			},
		],
	}),
})

export const repositoryArn = repository.arn
export const repositoryName = repository.name
export const repositoryUrl = repository.repositoryUrl
