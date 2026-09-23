CREATE TYPE "public"."juno_coin_format" AS ENUM('post', 'reel');--> statement-breakpoint
CREATE TYPE "public"."juno_plan_cadence" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "juno_follows" (
	"follower_wallet" varchar(42) NOT NULL,
	"target_wallet" varchar(42) NOT NULL,
	"network" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "juno_follows_follower_wallet_target_wallet_network_pk" PRIMARY KEY("follower_wallet","target_wallet","network")
);
--> statement-breakpoint
CREATE TABLE "juno_log_cursor" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_plans" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"token" varchar(42) NOT NULL,
	"network" varchar(16) NOT NULL,
	"amount" double precision NOT NULL,
	"cadence" "juno_plan_cadence" NOT NULL,
	"target" double precision,
	"contributed" double precision DEFAULT 0 NOT NULL,
	"fills" integer DEFAULT 0 NOT NULL,
	"last_filled_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_pools" (
	"token" varchar(42) PRIMARY KEY NOT NULL,
	"launchpad" varchar(42) NOT NULL,
	"pair" varchar(42),
	"quote_token" varchar(42) NOT NULL,
	"creator_wallet" varchar(42) NOT NULL,
	"network" varchar(16) NOT NULL,
	"name" text NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"description" text,
	"format" "juno_coin_format" DEFAULT 'post' NOT NULL,
	"curve_preset" varchar(32) NOT NULL,
	"media_url" text,
	"poster_url" text,
	"media_mime" text,
	"media_width" integer,
	"media_height" integer,
	"nav_feed_id" text,
	"nav_units_per_token" double precision,
	"create_tx" varchar(66) NOT NULL,
	"create_block" bigint,
	"listed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_posts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"author_wallet" varchar(42) NOT NULL,
	"network" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"token" varchar(42),
	"media_url" text,
	"media_mime" text,
	"parent_id" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_swaps" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"token" varchar(42) NOT NULL,
	"network" varchar(16) NOT NULL,
	"side" varchar(4) NOT NULL,
	"base_amount" double precision NOT NULL,
	"quote_amount" double precision NOT NULL,
	"fee" double precision DEFAULT 0 NOT NULL,
	"price" double precision NOT NULL,
	"trader" varchar(42) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "juno_watchlist" (
	"wallet" varchar(42) NOT NULL,
	"token" varchar(42) NOT NULL,
	"network" varchar(16) NOT NULL,
	"alert_price" double precision,
	"alert_set_at_price" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "juno_watchlist_wallet_token_network_pk" PRIMARY KEY("wallet","token","network")
);
--> statement-breakpoint
CREATE INDEX "juno_follows_target_idx" ON "juno_follows" USING btree ("network","target_wallet");--> statement-breakpoint
CREATE INDEX "juno_follows_follower_idx" ON "juno_follows" USING btree ("network","follower_wallet");--> statement-breakpoint
CREATE INDEX "juno_plans_wallet_idx" ON "juno_plans" USING btree ("network","wallet");--> statement-breakpoint
CREATE INDEX "juno_plans_token_idx" ON "juno_plans" USING btree ("network","token");--> statement-breakpoint
CREATE INDEX "juno_pools_network_created_idx" ON "juno_pools" USING btree ("network","created_at");--> statement-breakpoint
CREATE INDEX "juno_pools_creator_idx" ON "juno_pools" USING btree ("creator_wallet");--> statement-breakpoint
CREATE INDEX "juno_posts_network_created_idx" ON "juno_posts" USING btree ("network","created_at");--> statement-breakpoint
CREATE INDEX "juno_posts_author_idx" ON "juno_posts" USING btree ("author_wallet");--> statement-breakpoint
CREATE INDEX "juno_posts_token_idx" ON "juno_posts" USING btree ("token");--> statement-breakpoint
CREATE INDEX "juno_posts_parent_idx" ON "juno_posts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "juno_swaps_token_block_idx" ON "juno_swaps" USING btree ("token","block_number");--> statement-breakpoint
CREATE INDEX "juno_swaps_trader_idx" ON "juno_swaps" USING btree ("network","trader");--> statement-breakpoint
CREATE UNIQUE INDEX "juno_swaps_tx_log_idx" ON "juno_swaps" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "juno_watchlist_wallet_idx" ON "juno_watchlist" USING btree ("network","wallet");--> statement-breakpoint
CREATE INDEX "juno_watchlist_token_idx" ON "juno_watchlist" USING btree ("network","token");