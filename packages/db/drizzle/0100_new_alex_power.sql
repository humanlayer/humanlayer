CREATE TABLE "fold_session_events" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "fold_session_events_session_id_seq_pk" PRIMARY KEY("session_id","seq"),
	CONSTRAINT "fold_session_events_session_id_event_id_unique" UNIQUE("session_id","event_id"),
	CONSTRAINT "fold_session_events_relational_envelope_check" CHECK ("fold_session_events"."event" @> jsonb_build_object('seq', "fold_session_events"."seq", 'eventId', "fold_session_events"."event_id", 'ts', "fold_session_events"."ts"))
);
--> statement-breakpoint
ALTER TABLE "fold_session_events" ADD CONSTRAINT "fold_session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;