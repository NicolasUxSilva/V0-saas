ALTER TYPE "public"."provider" ADD VALUE 'rd_station_marketing';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'rd_station_crm';--> statement-breakpoint
CREATE TABLE "fact_conversion_assets_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" text DEFAULT 'rd_station_marketing' NOT NULL,
	"date" date NOT NULL,
	"asset_id" text NOT NULL,
	"asset_identifier" text DEFAULT '' NOT NULL,
	"asset_type" text DEFAULT '' NOT NULL,
	"visits" bigint DEFAULT 0 NOT NULL,
	"conversions" bigint DEFAULT 0 NOT NULL,
	"conversion_rate" numeric(9, 6),
	"dims" jsonb,
	"source_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" text DEFAULT 'rd_station_crm' NOT NULL,
	"deal_id" text NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"total_price" numeric(18, 4) DEFAULT 0 NOT NULL,
	"pipeline_id" text DEFAULT '' NOT NULL,
	"stage_id" text DEFAULT '' NOT NULL,
	"source_id" text DEFAULT '' NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"lost_reason_id" text DEFAULT '' NOT NULL,
	"deal_created_at" date NOT NULL,
	"deal_updated_at" timestamp with time zone NOT NULL,
	"deal_closed_at" date,
	"dims" jsonb,
	"source_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_conversion_assets_daily" ADD CONSTRAINT "fact_conversion_assets_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_conversion_assets_daily" ADD CONSTRAINT "fact_conversion_assets_daily_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_deals" ADD CONSTRAINT "fact_deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_deals" ADD CONSTRAINT "fact_deals_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_conversion_assets_daily_natural_uq" ON "fact_conversion_assets_daily" USING btree ("connection_id","platform","date","asset_id");--> statement-breakpoint
CREATE INDEX "fact_conversion_assets_daily_workspace_date_idx" ON "fact_conversion_assets_daily" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_deals_natural_uq" ON "fact_deals" USING btree ("connection_id","platform","deal_id");--> statement-breakpoint
CREATE INDEX "fact_deals_workspace_created_idx" ON "fact_deals" USING btree ("workspace_id","deal_created_at");--> statement-breakpoint
CREATE INDEX "fact_deals_workspace_closed_idx" ON "fact_deals" USING btree ("workspace_id","deal_closed_at");