import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const env = pulumi.getStack()

// Stack references
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const rdsStack = new pulumi.StackReference(`humanlayer/rds-postgres/${env}`)

// Import from core stack
const vpcId = coreStack.requireOutput('vpcId') as pulumi.Output<string>
const privateSubnetIds = coreStack.requireOutput('privateSubnetIds') as pulumi.Output<string[]>

// Import from RDS stack
const connectionUrlSecretArn = rdsStack.requireOutput('connectionUrlSecretArn') as pulumi.Output<string>
const rdsSecurityGroupId = rdsStack.requireOutput('securityGroupId') as pulumi.Output<string>

const config = new pulumi.Config()
const sentryEnvironment = config.require('sentryEnvironment')
const sentryDsn = config.require('sentryDsn')

// --- IAM Role for Lambda ---
const lambdaRole = new aws.iam.Role('migrator-lambda-role', {
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

// Attach basic Lambda execution policy (CloudWatch Logs)
const lambdaBasicPolicy = new aws.iam.RolePolicyAttachment('migrator-lambda-basic-policy', {
	role: lambdaRole.name,
	policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
})

// Attach VPC access policy for Lambda
const lambdaVpcPolicy = new aws.iam.RolePolicyAttachment('migrator-lambda-vpc-policy', {
	role: lambdaRole.name,
	policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
})

// Policy to allow reading the database connection URL secret
const secretsPolicy = new aws.iam.RolePolicy('migrator-secrets-policy', {
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

// --- Security Group for Lambda ---
const lambdaSecurityGroup = new aws.ec2.SecurityGroup('migrator-lambda-sg', {
	description: 'Security group for database migrator Lambda',
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

// Add ingress rule to RDS security group to allow Lambda to connect
const rdsIngressFromLambda = new aws.ec2.SecurityGroupRule('rds-ingress-from-migrator', {
	type: 'ingress',
	securityGroupId: rdsSecurityGroupId,
	sourceSecurityGroupId: lambdaSecurityGroup.id,
	protocol: 'tcp',
	fromPort: 5432,
	toPort: 5432,
	description: 'Allow PostgreSQL access from migrator Lambda',
})

// --- Content hashing for triggers ---
// hash all migration file contents together to determine if migrations have changed
// hash all migration code (single dist/ file) to determine if migration code has changed
// only trigger lambda if either has changed
// ---
function getMigrationsHash(): string {
	const migrationsDir = path.join(__dirname, '../../humanlayer/packages/db/drizzle')
	try {
		if (!fs.existsSync(migrationsDir)) {
			console.warn('Warning: drizzle migrations directory not found. Run `bun run db:migrations:generate` first.')
			return 'no-migrations'
		}
		const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
		if (files.length === 0) {
			return 'no-migrations'
		}
		const hash = crypto.createHash('sha256')
		for (const file of files.sort()) {
			const content = fs.readFileSync(path.join(migrationsDir, file))
			hash.update(content)
		}
		return hash.digest('hex').substring(0, 16)
	} catch (e) {
		console.error('Error calculating migrations hash:', e)
		return 'error-hash'
	}
}

function getMigratorCodeHash(): string {
	const migratorFile = path.join(__dirname, '../../humanlayer/apps/riptide-migrator/dist/index.js')
	try {
		if (!fs.existsSync(migratorFile)) {
			console.warn('Warning: dist/index.js not found. Run `bun run build` in humanlayer/apps/riptide-migrator first.')
			return 'not-built'
		}
		const content = fs.readFileSync(migratorFile)
		return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16)
	} catch {
		return 'error-hash'
	}
}

const migrationsHash = getMigrationsHash()
const codeHash = getMigratorCodeHash()

// --- CloudWatch Log Group ---
const logGroup = new aws.cloudwatch.LogGroup('migrator-logs', {
	name: `/aws/lambda/db-migrator-${env}`,
	retentionInDays: 365,
})

// --- Lambda Function ---
const migratorFunction = new aws.lambda.Function(
	'migrator-function',
	{
		name: `db-migrator-${env}`,
		runtime: aws.lambda.Runtime.NodeJS22dX,
		handler: 'index.handler',
		role: lambdaRole.arn,
		timeout: 120,
		memorySize: 256,
		code: new pulumi.asset.AssetArchive({
			'index.js': new pulumi.asset.FileAsset(path.join(__dirname, '../../humanlayer/apps/riptide-migrator/dist/index.js')),
			drizzle: new pulumi.asset.FileArchive(path.join(__dirname, '../../humanlayer/packages/db/drizzle')),
		}),
		environment: {
			variables: {
				DATABASE_URL_SECRET_ARN: connectionUrlSecretArn,
				MIGRATIONS_HASH: migrationsHash,
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

// --- Invoke Lambda to run migrations ---
const migratorInvocation = new aws.lambda.Invocation(
	'migrator-invocation',
	{
		functionName: migratorFunction.name,
		input: JSON.stringify({
			action: 'migrate',
			timestamp: new Date().toISOString(),
		}),
		triggers: {
			migrationsHash,
			codeHash,
		},
	},
	{ dependsOn: [rdsIngressFromLambda] },
)

// --- Exports ---
export const functionArn = migratorFunction.arn
export const functionName = migratorFunction.name
export const invocationResult = migratorInvocation.result
export const lambdaSecurityGroupId = lambdaSecurityGroup.id
