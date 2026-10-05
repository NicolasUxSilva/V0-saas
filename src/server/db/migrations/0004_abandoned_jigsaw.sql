CREATE TABLE "cross_source_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	"insight_period_start" date NOT NULL,
	"insight_period_end" date NOT NULL,
	"sources_json" jsonb NOT NULL,
	"statements_json" jsonb NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cross_source_insights" ADD CONSTRAINT "cross_source_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cross_source_insights_workspace_period_key_uq" ON "cross_source_insights" USING btree ("workspace_id","period_start","period_end","dedupe_key");