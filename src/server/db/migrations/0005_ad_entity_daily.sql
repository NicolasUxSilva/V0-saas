CREATE TABLE "fact_ad_entity_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_id" text DEFAULT '' NOT NULL,
	"level" text NOT NULL,
	"date" date NOT NULL,
	"campaign_id" text NOT NULL,
	"ad_group_id" text NOT NULL,
	"ad_group_name" text DEFAULT '' NOT NULL,
	"ad_id" text DEFAULT '' NOT NULL,
	"ad_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"entity_type" text DEFAULT '' NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"cost" numeric(18, 4) NOT NULL,
	"conversions" numeric(18, 4) NOT NULL,
	"conversion_value" numeric(18, 4) NOT NULL,
	"currency" text,
	"dims" jsonb,
	"source_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_ad_entity_daily" ADD CONSTRAINT "fact_ad_entity_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_ad_entity_daily" ADD CONSTRAINT "fact_ad_entity_daily_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_ad_entity_daily_natural_uq" ON "fact_ad_entity_daily" USING btree ("connection_id","platform","level","date","campaign_id","ad_group_id","ad_id");--> statement-breakpoint
CREATE INDEX "fact_ad_entity_daily_workspace_campaign_idx" ON "fact_ad_entity_daily" USING btree ("workspace_id","platform","campaign_id","date");