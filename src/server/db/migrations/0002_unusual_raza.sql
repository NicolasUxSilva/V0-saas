CREATE TABLE "fact_ad_performance_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" text DEFAULT 'google_ads' NOT NULL,
	"date" date NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"campaign_status" text DEFAULT '' NOT NULL,
	"ad_network" text DEFAULT '' NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"cost" numeric(18, 4) NOT NULL,
	"conversions" numeric(18, 4) NOT NULL,
	"conversion_value" numeric(18, 4) NOT NULL,
	"impression_share" numeric(9, 6),
	"budget_lost_is" numeric(9, 6),
	"rank_lost_is" numeric(9, 6),
	"currency" text,
	"dims" jsonb,
	"source_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_ad_performance_daily" ADD CONSTRAINT "fact_ad_performance_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_ad_performance_daily" ADD CONSTRAINT "fact_ad_performance_daily_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_ad_performance_daily_natural_uq" ON "fact_ad_performance_daily" USING btree ("connection_id","platform","date","campaign_id","ad_network");--> statement-breakpoint
CREATE INDEX "fact_ad_performance_daily_workspace_date_idx" ON "fact_ad_performance_daily" USING btree ("workspace_id","date");