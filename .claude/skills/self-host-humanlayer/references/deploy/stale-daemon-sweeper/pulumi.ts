import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const env = pulumi.getStack()

const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const rdsStack = new pulumi.StackReference(`humanlayer/rds-postgres/${env}`)
const config = new pulumi.Config()

const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const privateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const connectionUrlSecretArn = rdsStack.requireOutput('connectionUrlSecretArn') as pulumi.Output<string>
const rdsSecurityGroupId = rdsStack.requireOutput('securityGroupId') as pulumi.Output<string>
const sentryDsn = config.require('sentryDsn')
const sentryEnvironment = config.require('sentryEnvironment')
const sentryLayerArn = config.require('sentryLayerArn')

function getCodeHash(): string {
	const bundle = path.join(__dirname, '../../humanlayer/apps/stale-daemon-sweeper/dist/index.js')
	if (!fs.existsSync(bundle)) {
		console.warn('Warning: dist/index.js not found. Run `bun run build` in humanlayer/apps/stale-daemon-sweeper first.')
		return 'not-built'
	}
	return fs.readFileSync(bundle).toString('base64').slice(0, 16)
}

const lambdaRole = new aws.iam.Role('stale-daemon-sweeper-lambda-role', {
	assumeRolePolicy: JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Action: 'sts:AssumeRole',
				Principal: { Service: 'lambda.amazonaws.com' },
				Effect: 'Allow',
			},
		],
	}),
})

const lambdaBasicPolicy = new aws.iam.RolePolicyAttachment('stale-daemon-sweeper-lambda-basic-policy', {
	role: lambdaRole.name,
	policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
})

const lambdaVpcPolicy = new aws.iam.RolePolicyAttachment('stale-daemon-sweeper-lambda-vpc-policy', {
	role: lambdaRole.name,
	policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
})

const secretsPolicy = new aws.iam.RolePolicy('stale-daemon-sweeper-secrets-policy', {
	role: lambdaRole.name,
	policy: connectionUrlSecretArn.apply((arn) =>
		JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Effect: 'Allow',
					Action: ['secretsmanager:GetSecretValue'],
					Resource: arn,
				},
			],
		}),
	),
})

const lambdaSecurityGroup = new aws.ec2.SecurityGroup('stale-daemon-sweeper-lambda-sg', {
	description: 'Security group for the stale daemon sweeper Lambda',
	vpcId,
	egress: [
		{
			protocol: '-1',
			fromPort: 0,
			toPort: 0,
			cidrBlocks: ['0.0.0.0/0'],
		},
	],
})

const rdsIngressFromLambda = new aws.ec2.SecurityGroupRule('rds-ingress-from-stale-daemon-sweeper', {
	type: 'ingress',
	securityGroupId: rdsSecurityGroupId,
	sourceSecurityGroupId: lambdaSecurityGroup.id,
	protocol: 'tcp',
	fromPort: 5432,
	toPort: 5432,
	description: 'Allow PostgreSQL access from the stale daemon sweeper Lambda',
})

const logGroup = new aws.cloudwatch.LogGroup('stale-daemon-sweeper-logs', {
	name: `/aws/lambda/stale-daemon-sweeper-${env}`,
	retentionInDays: 365,
})

const sweeperFunction = new aws.lambda.Function(
	'stale-daemon-sweeper-function',
	{
		name: `stale-daemon-sweeper-${env}`,
		runtime: aws.lambda.Runtime.NodeJS22dX,
		handler: 'index.handler',
		role: lambdaRole.arn,
		timeout: 60,
		memorySize: 256,
		layers: [sentryLayerArn],
		code: new pulumi.asset.AssetArchive({
			'index.js': new pulumi.asset.FileAsset(path.join(__dirname, '../../humanlayer/apps/stale-daemon-sweeper/dist/index.js')),
		}),
		environment: {
			variables: {
				DATABASE_URL_SECRET_ARN: connectionUrlSecretArn,
				NODE_OPTIONS: '--import @sentry/aws-serverless/awslambda-auto',
				SENTRY_DSN: sentryDsn,
				SENTRY_ENVIRONMENT: sentryEnvironment,
				SWEEPER_CODE_HASH: getCodeHash(),
			},
		},
		vpcConfig: {
			subnetIds: privateSubnetIds,
			securityGroupIds: [lambdaSecurityGroup.id],
		},
	},
	{ dependsOn: [lambdaBasicPolicy, lambdaVpcPolicy, secretsPolicy, logGroup] },
)

const schedulerRole = new aws.iam.Role('stale-daemon-sweeper-scheduler-role', {
	assumeRolePolicy: JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Action: 'sts:AssumeRole',
				Principal: { Service: 'scheduler.amazonaws.com' },
				Effect: 'Allow',
			},
		],
	}),
})

const schedulerInvokePolicy = new aws.iam.RolePolicy('stale-daemon-sweeper-scheduler-invoke-policy', {
	role: schedulerRole.name,
	policy: sweeperFunction.arn.apply((arn) =>
		JSON.stringify({
			Version: '2012-10-17',
			Statement: [{ Effect: 'Allow', Action: ['lambda:InvokeFunction'], Resource: arn }],
		}),
	),
})

const schedule = new aws.scheduler.Schedule(
	'stale-daemon-sweeper-schedule',
	{
		description: 'Mark timed-out Riptide daemons offline',
		flexibleTimeWindow: { mode: 'OFF' },
		scheduleExpression: 'rate(1 minute)',
		target: {
			arn: sweeperFunction.arn,
			roleArn: schedulerRole.arn,
			retryPolicy: {
				maximumRetryAttempts: 0,
				maximumEventAgeInSeconds: 60,
			},
		},
	},
	{ dependsOn: [schedulerInvokePolicy] },
)

export const functionArn = sweeperFunction.arn
export const functionName = sweeperFunction.name
export const lambdaSecurityGroupId = lambdaSecurityGroup.id
export const scheduleArn = schedule.arn
export const rdsIngressRuleId = rdsIngressFromLambda.id
