import { Match } from 'effect'

import type { ResendContactProperty, ResendContactResponse } from '../resend.schema'
import type { ResendContact } from '../resend.service'

const projectContactProperty = Match.type<ResendContactProperty>().pipe(
	Match.discriminatorsExhaustive('type')({
		string: ({ value }) => value,
		number: ({ value }) => String(value),
	}),
)

/** Projects Resend's typed contact-property values into the service's string property model. */
export const projectResendContact = (contact: ResendContactResponse): ResendContact => ({
	id: contact.id,
	email: contact.email,
	firstName: contact.first_name,
	lastName: contact.last_name,
	unsubscribed: contact.unsubscribed,
	properties: Object.fromEntries(
		Object.entries(contact.properties).map(([key, property]) => [key, projectContactProperty(property)]),
	),
})
