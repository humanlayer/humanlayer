import { Context, Duration, Schedule } from 'effect'

/**
 * Service for defining the schedule for retries for the API calls
 */
export class LmRetryScheduleService extends Context.Service<
	LmRetryScheduleService,
	{
		readonly schedule: Schedule.Schedule<unknown, unknown>
	}
>()('LmRetryScheduleService') {}

/**
 * Service for error callback for when a single API call fails
 */
export class OnLmErrorService extends Context.Service<
	OnLmErrorService,
	{
		readonly onError: (error: unknown) => void
	}
>()('OnLmErrorService') {}

/**
 * Service for the failure callback when the entire pipeline fails
 */
export class OnLmFailureService extends Context.Service<
	OnLmFailureService,
	{
		readonly onFailure: (error: unknown) => void
	}
>()('OnLmFailureService') {}

/**
 * Default backoff schedule - 250ms ** 2, 3x - 250ms, 500ms, 1000ms
 */
export const defaultLmRetrySchedule: Schedule.Schedule<unknown, unknown> = Schedule.exponential(
	Duration.millis(250),
	2,
).pipe(Schedule.upTo({ times: 3 }))
