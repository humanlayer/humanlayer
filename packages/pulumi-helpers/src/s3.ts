export function denyInsecureTransportStatement(bucketArn: string) {
	return {
		Sid: 'DenyInsecureTransport',
		Effect: 'Deny',
		Principal: '*',
		Action: 's3:*',
		Resource: [bucketArn, `${bucketArn}/*`],
		Condition: {
			Bool: {
				'aws:SecureTransport': 'false',
			},
		},
	} as const
}
