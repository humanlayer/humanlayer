// TEMPLATE. A cut-down copy of HumanLayer's monitoring stack. It keeps the ECS event capture,
// crash-loop, deploy-failure, service-down, Lambda-error and billing alarms, all sent to core's SNS
// alarm topic. Slack (AWS Chatbot) and GuardDuty are optional. Wire the SNS topic to whatever
// alerting you use (PagerDuty, email, Opsgenie, ...).
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
const slackChannelId = config.get('slackChannelId')
const slackWorkspaceId = config.get('slackWorkspaceId')
const guardDutyDetectorId = config.get('guarddutyDetectorId')

const env = pulumi.getStack()

// Stack references
const coreStack = new pulumi.StackReference(`humanlayer/core/${env}`)
const electricStack = new pulumi.StackReference(`humanlayer/electric-sql/${env}`)
const apiStack = new pulumi.StackReference(`humanlayer/riptide-api/${env}`)
const proxyStack = new pulumi.StackReference(`humanlayer/riptide-electric-proxy/${env}`)
const rustDurableStreamsStack = new pulumi.StackReference(`humanlayer/rust-durable-streams/${env}`)

// Import from core stack
const ecsClusterArn = coreStack.requireOutput('ecsClusterArn')
const alarmTopicArn = coreStack.requireOutput('alarmTopicArn') as pulumi.Output<string>

// ECS service names for Container Insights alarms
const electricServiceName = electricStack.requireOutput('ecsServiceName') as pulumi.Output<string>
const apiServiceName = apiStack.requireOutput('ecsServiceName') as pulumi.Output<string>
const proxyServiceName = proxyStack.requireOutput('ecsServiceName') as pulumi.Output<string>
const rustDurableStreamsServiceName = rustDurableStreamsStack.requireOutput('ecsServiceName') as pulumi.Output<string>

const clusterName = ecsClusterArn.apply((arn: string) => {
	const name = arn.split('/').pop()
	if (name === undefined) throw new Error(`malformed cluster ARN: ${arn}`)
	return name
})

let guardDutyFindingsRuleName: pulumi.Output<string> | undefined

// ========================================
// ECS Event Capture via EventBridge
// ========================================
const ecsEventsLogGroup = new aws.cloudwatch.LogGroup('ecs-events-logs', {
	name: `/aws/events/ecs-events-${env}`,
	retentionInDays: 365,
})

const ecsEventsRule = new aws.cloudwatch.EventRule('ecs-events-rule', {
	name: `ecs-events-${env}`,
	description: 'Capture ECS task, service action, and container instance events from the codelayer cluster',
	eventPattern: ecsClusterArn.apply((arn) =>
		JSON.stringify({
			source: ['aws.ecs'],
			'detail-type': ['ECS Task State Change', 'ECS Service Action', 'ECS Container Instance State Change'],
			detail: { clusterArn: [arn] },
		}),
	),
})

// Deployment state change events don't have clusterArn in detail — filter via resources array
const serviceArnPrefix = ecsClusterArn.apply((arn) => arn.replace(':cluster/', ':service/') + '/')

const ecsDeploymentEventsRule = new aws.cloudwatch.EventRule('ecs-deployment-events-rule', {
	name: `ecs-deployment-events-${env}`,
	description: 'Capture ECS deployment state change events from the codelayer cluster',
	eventPattern: serviceArnPrefix.apply((prefix) =>
		JSON.stringify({
			source: ['aws.ecs'],
			'detail-type': ['ECS Deployment State Change'],
			resources: [{ prefix }],
		}),
	),
})

const eventsLogPolicy = new aws.cloudwatch.LogResourcePolicy('events-to-cloudwatch-policy', {
	policyName: 'eventbridge-to-cloudwatch-logs',
	policyDocument: JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Effect: 'Allow',
				Principal: { Service: ['events.amazonaws.com', 'delivery.logs.amazonaws.com'] },
				Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
				Resource: 'arn:aws:logs:*:*:log-group:/aws/events/*:*',
			},
		],
	}),
})

const _ecsEventsTarget = new aws.cloudwatch.EventTarget(
	'ecs-events-to-cloudwatch',
	{
		rule: ecsEventsRule.name,
		arn: ecsEventsLogGroup.arn,
		targetId: 'ecs-events-cloudwatch-logs',
	},
	{ dependsOn: [eventsLogPolicy] },
)

const _ecsDeploymentEventsTarget = new aws.cloudwatch.EventTarget(
	'ecs-deployment-events-to-cloudwatch',
	{
		rule: ecsDeploymentEventsRule.name,
		arn: ecsEventsLogGroup.arn,
		targetId: 'ecs-deployment-events-cloudwatch-logs',
	},
	{ dependsOn: [eventsLogPolicy] },
)

// ========================================
// GuardDuty Finding Notifications
// ========================================
if (guardDutyDetectorId) {
	const _guardDutyDetector = new aws.guardduty.Detector(
		'guardduty-detector',
		{
			enable: true,
			findingPublishingFrequency: 'SIX_HOURS',
		},
		{ import: guardDutyDetectorId },
	)

	const callerIdentity = await aws.getCallerIdentity()

	const guardDutyFindingsRule = new aws.cloudwatch.EventRule('guardduty-findings-rule', {
		name: `guardduty-findings-${env}`,
		description: 'GuardDuty findings (severity >= 4.0 / Medium and above) routed to alerting',
		eventPattern: JSON.stringify({
			source: ['aws.guardduty'],
			'detail-type': ['GuardDuty Finding'],
			detail: { severity: [{ numeric: ['>=', 4] }] },
		}),
	})

	const alarmTopicPolicy = new aws.sns.TopicPolicy('alarm-topic-policy', {
		arn: alarmTopicArn,
		policy: pulumi.all([alarmTopicArn, callerIdentity.accountId]).apply(([arn, accountId]) =>
			JSON.stringify({
				Version: '2012-10-17',
				Statement: [
					{
						Sid: 'OwnerFullAccess',
						Effect: 'Allow',
						Principal: { AWS: '*' },
						Action: [
							'SNS:GetTopicAttributes',
							'SNS:SetTopicAttributes',
							'SNS:AddPermission',
							'SNS:RemovePermission',
							'SNS:DeleteTopic',
							'SNS:Subscribe',
							'SNS:ListSubscriptionsByTopic',
							'SNS:Publish',
							'SNS:Receive',
						],
						Resource: arn,
						Condition: { StringEquals: { 'AWS:SourceOwner': accountId } },
					},
					{
						Sid: 'AllowCloudWatchAlarms',
						Effect: 'Allow',
						Principal: { Service: 'cloudwatch.amazonaws.com' },
						Action: 'SNS:Publish',
						Resource: arn,
					},
					{
						Sid: 'AllowEventBridge',
						Effect: 'Allow',
						Principal: { Service: 'events.amazonaws.com' },
						Action: 'SNS:Publish',
						Resource: arn,
					},
				],
			}),
		),
	})

	const _guardDutyToSns = new aws.cloudwatch.EventTarget(
		'guardduty-findings-to-sns',
		{
			rule: guardDutyFindingsRule.name,
			arn: alarmTopicArn,
			targetId: 'guardduty-findings-sns',
		},
		{ dependsOn: [alarmTopicPolicy] },
	)

	const _guardDutyToLogs = new aws.cloudwatch.EventTarget(
		'guardduty-findings-to-cloudwatch',
		{
			rule: guardDutyFindingsRule.name,
			arn: ecsEventsLogGroup.arn,
			targetId: 'guardduty-findings-cloudwatch-logs',
		},
		{ dependsOn: [eventsLogPolicy] },
	)

	guardDutyFindingsRuleName = guardDutyFindingsRule.name
}

// ========================================
// ECS Crash Loop Detection
// ========================================
const _crashMetricFilter = new aws.cloudwatch.LogMetricFilter('ecs-crash-metric-filter', {
	logGroupName: ecsEventsLogGroup.name,
	name: `ecs-task-crashes-${env}`,
	pattern: '{ $.detail.stopCode = "EssentialContainerExited" || $.detail.stopCode = "TaskFailedToStart" }',
	metricTransformation: {
		name: `ECSTaskCrashes-${env}`,
		namespace: 'Custom/ECS',
		value: '1',
		defaultValue: '0',
	},
})

const _crashAlarm = new aws.cloudwatch.MetricAlarm('ecs-crash-loop-alarm', {
	comparisonOperator: 'GreaterThanOrEqualToThreshold',
	evaluationPeriods: 6,
	datapointsToAlarm: 3,
	metricName: `ECSTaskCrashes-${env}`,
	namespace: 'Custom/ECS',
	period: 300,
	statistic: 'Sum',
	threshold: 1,
	treatMissingData: 'notBreaching',
	alarmDescription: 'ECS tasks crashing repeatedly — 3+ crashes in 30 min',
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ========================================
// ECS Deployment Failure Detection
// ========================================
const _deploymentFailureMetricFilter = new aws.cloudwatch.LogMetricFilter('ecs-deployment-failure-metric-filter', {
	logGroupName: ecsEventsLogGroup.name,
	name: `ecs-deployment-failures-${env}`,
	pattern: '{ $.detail.eventName = "SERVICE_DEPLOYMENT_FAILED" }',
	metricTransformation: {
		name: `ECSDeploymentFailures-${env}`,
		namespace: 'Custom/ECS',
		value: '1',
		defaultValue: '0',
	},
})

const _deploymentFailureAlarm = new aws.cloudwatch.MetricAlarm('ecs-deployment-failure-alarm', {
	comparisonOperator: 'GreaterThanOrEqualToThreshold',
	evaluationPeriods: 1,
	metricName: `ECSDeploymentFailures-${env}`,
	namespace: 'Custom/ECS',
	period: 300,
	statistic: 'Sum',
	threshold: 1,
	treatMissingData: 'notBreaching',
	alarmDescription: 'ECS deployment failed — circuit breaker triggered rollback',
	alarmActions: [alarmTopicArn],
	okActions: [alarmTopicArn],
})

// ========================================
// Per-Service "Service Down" Alarms (Container Insights)
// ========================================
const services = [
	{ name: 'electric', serviceName: electricServiceName },
	{ name: 'electric-proxy', serviceName: proxyServiceName },
	{ name: 'riptide-api', serviceName: apiServiceName },
	{ name: 'rust-durable-streams', serviceName: rustDurableStreamsServiceName },
]

for (const svc of services) {
	new aws.cloudwatch.MetricAlarm(`${svc.name}-service-down`, {
		comparisonOperator: 'LessThanThreshold',
		evaluationPeriods: 1,
		metricName: 'RunningTaskCount',
		namespace: 'ECS/ContainerInsights',
		period: 60,
		statistic: 'Minimum',
		threshold: 1,
		treatMissingData: 'breaching',
		alarmDescription: `${svc.name} has 0 running tasks — service is down`,
		dimensions: {
			ClusterName: clusterName,
			ServiceName: svc.serviceName,
		},
		alarmActions: [alarmTopicArn],
		okActions: [alarmTopicArn],
	})
}

// ========================================
// Lambda Error Alarms
// ========================================
const lambdaFunctionNames = [
	`database-maintenance-${env}`,
	`updater-server-${env}`,
	`db-migrator-${env}`,
	`stale-daemon-sweeper-${env}`,
]

for (const functionName of lambdaFunctionNames) {
	new aws.cloudwatch.MetricAlarm(`${functionName}-errors`, {
		comparisonOperator: 'GreaterThanOrEqualToThreshold',
		evaluationPeriods: 1,
		metricName: 'Errors',
		namespace: 'AWS/Lambda',
		period: 300,
		statistic: 'Sum',
		threshold: 1,
		treatMissingData: 'notBreaching',
		alarmDescription: `${functionName} reported Lambda invocation errors`,
		dimensions: {
			FunctionName: functionName,
		},
		alarmActions: [alarmTopicArn],
		okActions: [alarmTopicArn],
	})
}

// ========================================
// Billing Operations Alarms
// ========================================
const billingAlarmMetrics = [
	{
		name: 'billing-webhook-failures',
		metricName: `StripeWebhookFailures-${env}`,
		description: 'Stripe webhook verification or processing failures detected',
	},
	{
		name: 'billing-reconcile-mismatches',
		metricName: `BillingReconcileMismatches-${env}`,
		description: 'Billing reconciliation reported mismatches',
	},
]

for (const metric of billingAlarmMetrics) {
	new aws.cloudwatch.MetricAlarm(metric.name, {
		comparisonOperator: 'GreaterThanOrEqualToThreshold',
		evaluationPeriods: 1,
		metricName: metric.metricName,
		namespace: 'Custom/Billing',
		period: 300,
		statistic: 'Sum',
		threshold: 1,
		treatMissingData: 'notBreaching',
		alarmDescription: metric.description,
		alarmActions: [alarmTopicArn],
		okActions: [alarmTopicArn],
	})
}

// ========================================
// AWS Chatbot — Slack Alarm Notifications
// ========================================
if (slackChannelId && slackWorkspaceId) {
	const chatbotRole = new aws.iam.Role('chatbot-role', {
		assumeRolePolicy: JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Effect: 'Allow',
					Principal: { Service: 'chatbot.amazonaws.com' },
					Action: 'sts:AssumeRole',
				},
			],
		}),
	})

	const _chatbotRolePolicy = new aws.iam.RolePolicyAttachment('chatbot-cloudwatch-readonly', {
		role: chatbotRole.name,
		policyArn: 'arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess',
	})

	const chatbotLogGroupName = `/aws/chatbot/alarm-notifications-${env}`
	const chatbotLogGroup = new aws.cloudwatch.LogGroup(
		'chatbot-logs',
		{
			name: chatbotLogGroupName,
			retentionInDays: 365,
		},
	)

	const _slackChannel = new aws.chatbot.SlackChannelConfiguration(
		'alarm-slack-channel',
		{
			configurationName: `alarm-notifications-${env}`,
			iamRoleArn: chatbotRole.arn,
			slackChannelId: slackChannelId,
			slackTeamId: slackWorkspaceId,
			snsTopicArns: [alarmTopicArn],
			loggingLevel: 'ERROR',
			guardrailPolicyArns: ['arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess'],
		},
		{ dependsOn: [chatbotLogGroup] },
	)
}

// ========================================
// Exports
// ========================================
export const ecsEventsLogGroupName = ecsEventsLogGroup.name
export const ecsEventsRuleName = ecsEventsRule.name
export const ecsDeploymentEventsRuleName = ecsDeploymentEventsRule.name
export { guardDutyFindingsRuleName }
