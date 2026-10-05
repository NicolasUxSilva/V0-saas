CREATE TYPE "public"."connection_status" AS ENUM('connected', 'reauth_required', 'error');--> statement-breakpoint
CREATE TYPE "public"."insight_confidence" AS ENUM('alta', 'media');--> statement-breakpoint
CREATE TYPE "public"."insight_kind" AS ENUM('problem', 'opportunity', 'data_quality');--> statement-breakpoint
CREATE TYPE "public"."insight_severity" AS ENUM('critical', 'attention');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('open', 'acknowledged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('ga4', 'google_ads', 'meta_ads', 'rd_station');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('manual', 'initial');--> statement-breakpoint
CREATE TABLE "connection_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text,
	"currency" text,
	"is_selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"external_account_email" text,
	"access_token_enc" "bytea",
	"refresh_token_enc" "bytea",
	"token_expires_at" timestamp with time zone,
	"scopes" text[],
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "fact_traffic_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"date" date NOT NULL,
	"channel" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"medium" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"sessions" bigint DEFAULT 0 NOT NULL,
	"total_users" bigint DEFAULT 0 NOT NULL,
	"new_users" bigint DEFAULT 0 NOT NULL,
	"engaged_sessions" bigint DEFAULT 0 NOT NULL,
	"avg_engagement_time" numeric(18, 4) NOT NULL,
	"key_events" numeric(18, 4) NOT NULL,
	"conversion_value" numeric(18, 4) NOT NULL,
	"dims" jsonb,
	"source_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"detector" text NOT NULL,
	"kind" "insight_kind" NOT NULL,
	"severity" "insight_severity" NOT NULL,
	"status" "insight_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"impact_json" jsonb,
	"explanation" text NOT NULL,
	"hypothesis" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"compared_to" text,
	"responsible_dimension_json" jsonb,
	"confidence" "insight_confidence" NOT NULL,
	"confidence_basis_json" jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"priority_score" double precision NOT NULL,
	"dedupe_key" text NOT NULL,
	"rating" smallint,
	"gate_trace_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"stream" text NOT NULL,
	"occurred_on" date,
	"payload" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_status" NOT NULL,
	"period_start" date,
	"period_end" date,
	"rows_in" integer,
	"rows_written" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_properties" ADD CONSTRAINT "connection_properties_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_traffic_daily" ADD CONSTRAINT "fact_traffic_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_traffic_daily" ADD CONSTRAINT "fact_traffic_daily_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_properties_connection_idx" ON "connection_properties" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_properties_conn_external_uq" ON "connection_properties" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "connections_workspace_idx" ON "connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_workspace_provider_uq" ON "connections" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_traffic_daily_natural_uq" ON "fact_traffic_daily" USING btree ("connection_id","date","channel","source","medium","campaign");--> statement-breakpoint
CREATE INDEX "fact_traffic_daily_workspace_date_idx" ON "fact_traffic_daily" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_workspace_dedupe_uq" ON "insights" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "insights_workspace_status_idx" ON "insights" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "raw_records_conn_stream_date_idx" ON "raw_records" USING btree ("connection_id","stream","occurred_on");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_idx" ON "sync_runs" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_user_uq" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");