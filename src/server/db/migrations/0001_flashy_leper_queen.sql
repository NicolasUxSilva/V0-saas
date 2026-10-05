DROP INDEX "fact_traffic_daily_natural_uq";--> statement-breakpoint
ALTER TABLE "fact_traffic_daily" ADD COLUMN "platform" text DEFAULT 'ga4' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_traffic_daily_natural_uq" ON "fact_traffic_daily" USING btree ("connection_id","platform","date","channel","source","medium","campaign");