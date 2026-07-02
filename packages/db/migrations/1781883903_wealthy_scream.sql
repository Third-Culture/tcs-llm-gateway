CREATE TABLE "tcs_tier_routing_status" (
	"tier_id" text PRIMARY KEY,
	"tier_name" text NOT NULL,
	"status" text NOT NULL,
	"selected_provider" text,
	"selected_model" text,
	"primary_provider" text NOT NULL,
	"primary_model" text NOT NULL,
	"fallback_providers" jsonb DEFAULT '[]' NOT NULL,
	"last_checked_at" timestamp NOT NULL,
	"last_success_at" timestamp,
	"last_error" text,
	"latency_ms" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
