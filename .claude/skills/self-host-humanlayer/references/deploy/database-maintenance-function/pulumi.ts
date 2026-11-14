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

const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const privateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const connectionUrlSecretArn = rdsStack.requireOutput('connectionUrlSecretArn') as pulumi.Output<string>
const rdsSecurityGroupId = rdsStack.requireOutput('securityGroupId') as pulumi.Output<string>

const config = new pulumi.Config()
const sentryEnvironment = config.require('sentryEnvironment')
const sentryDsn = config.require('sentryDsn')
const scheduleExpression = config.get('scheduleExpression') ?? 'rate(1 day)'

function getMaintenanceCodeHash(): string {
	const maintenanceFile = path.join(__dirname, '../../humanlayer/apps/database-maintenance-function/dist/index.js')
	try {
		if (!fs.existsSync(maintenanceFile)) {
			console.warn(
				'Warning: dist/index.js not found. Run `bun run build` in humanlayer/apps/database-maintenance-function first.',
			)
			return 'not-built'
		}
		return fs.readFileSync(maintenanceFile).toString('base64').slice(0, 16)
	} catch {
		return 'error-hash'
	}
}

const codeHash = getMaintenanceCodeHash()

const lambdaRole = new aws.iam.Role('database-maintenance-lambda-role', {
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

const lambdaBasicPolicy = new aws.iam.RolePolicyAttachment('database-maintenance-lambda-basic-policy', {
	role: lambdaRole.name,
	policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
})

const lambdaVpcPolicy = new aws.iam.RolePolicyAttachment('database-maintenance-lambda-vpc-policy', {
	role: lambdaRole.name,
	policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
})

const secretsPolicy = new aws.iam.RolePolicy('database-maintenance-secrets-policy', {
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

const lambdaSecurityGroup = new aws.ec2.SecurityGroup('database-maintenance-lambda-sg', {
	description: 'Security group for database maintenance Lambda',
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

const rdsIngressFromLambda = new aws.ec2.SecurityGroupRule('rds-ingress-from-database-maintenance', {
	type: 'ingress',
	securityGroupId: rdsSecurityGroupId,
	sourceSecurityGroupId: lambdaSecurityGroup.id,
	protocol: 'tcp',
	fromPort: 5432,
	toPort: 5432,
	description: 'Allow PostgreSQL access from database maintenance Lambda',
})

const logGroup = new aws.cloudwatch.LogGroup('database-maintenance-logs', {
	name: `/aws/lambda/database-maintenance-${env}`,
	retentionInDays: 365,
})

const maintenanceFunction = new aws.lambda.Function(
	'database-maintenance-function',
	{
		name: `database-maintenance-${env}`,
		runtime: aws.lambda.Runtime.NodeJS22dX,
		handler: 'index.handler',
		role: lambdaRole.arn,
		timeout: 120,
		memorySize: 256,
		code: new pulumi.asset.AssetArchive({
			'index.js': new pulumi.asset.FileAsset(path.join(__dirname, '../../humanlayer/apps/database-maintenance-function/dist/index.js')),
		}),
		environment: {
			variables: {
				DATABASE_URL_SECRET_ARN: connectionUrlSecretArn,
				MAINTENANCE_CODE_HASH: codeHash,
				SENTRY_DSN: sentryDsn,
				SENTRY_ENVIRONMENT: sentryEnvironment,
			},
		},
		vpcConfig: {
			subnetIds: privateSubnetIds,
			securityGroupIds: [lambdaSecurityGroup.id],
		},
	},
	{ dependsOn: [lambdaBasicPolicy, lambdaVpcPolicy, secretsPolicy, logGroup] },
)

const scheduleRule = new aws.cloudwatch.EventRule('database-maintenance-schedule', {
	description: 'Schedule database maintenance cleanup jobs',
	scheduleExpression,
})

const scheduleTarget = new aws.cloudwatch.EventTarget('database-maintenance-schedule-target', {
	rule: scheduleRule.name,
	arn: maintenanceFunction.arn,
	input: JSON.stringify({ action: 'cleanupExpiredCodelayerForkSnapshots' }),
})

const schedulePermission = new aws.lambda.Permission('database-maintenance-schedule-permission', {
	action: 'lambda:InvokeFunction',
	function: maintenanceFunction.name,
	principal: 'events.amazonaws.com',
	sourceArn: scheduleRule.arn,
})

export const functionArn = maintenanceFunction.arn
export const functionName = maintenanceFunction.name
export const lambdaSecurityGroupId = lambdaSecurityGroup.id
export const scheduleRuleArn = scheduleRule.arn
export const scheduleTargetId = scheduleTarget.id
export const schedulePermissionId = schedulePermission.id
export const rdsIngressRuleId = rdsIngressFromLambda.id
