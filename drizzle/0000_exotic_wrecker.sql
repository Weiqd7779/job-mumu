CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_email` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`current_stage` text DEFAULT 'intent' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`input_type` text NOT NULL,
	`input_text` text NOT NULL,
	`normalized_intent_json` text,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`source_summary_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`model_id` text,
	`skill_version` text DEFAULT '1.0.0' NOT NULL,
	`prompt_hash` text,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `runs_project_created_idx` ON `analysis_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `runs_user_status_idx` ON `analysis_runs` (`user_email`,`status`);--> statement-breakpoint
CREATE TABLE `community_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`query` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`snippet` text NOT NULL,
	`published_at` text,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`firsthand` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `community_run_idx` ON `community_evidence` (`run_id`);--> statement-breakpoint
CREATE TABLE `cost_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`user_email` text,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`model_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`query_count` integer DEFAULT 0 NOT NULL,
	`cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cost_provider_created_idx` ON `cost_ledger` (`provider`,`created_at`);--> statement-breakpoint
CREATE TABLE `fact_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`project_id` text,
	`category` text NOT NULL,
	`claim` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`allowed_in_resume` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `facts_user_idx` ON `fact_cards` (`user_email`);--> statement-breakpoint
CREATE TABLE `job_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`reason` text NOT NULL,
	`representative_titles_json` text DEFAULT '[]' NOT NULL,
	`job_count` integer DEFAULT 0 NOT NULL,
	`included` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clusters_run_idx` ON `job_clusters` (`run_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `job_postings` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_job_id` text,
	`canonical_url` text,
	`title` text NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`required_text` text DEFAULT '' NOT NULL,
	`preferred_text` text DEFAULT '' NOT NULL,
	`salary_text` text DEFAULT '' NOT NULL,
	`published_at` text,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`content_hash` text NOT NULL,
	`license_type` text NOT NULL,
	`may_store_original` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_hash_uidx` ON `job_postings` (`source`,`content_hash`);--> statement-breakpoint
CREATE INDEX `jobs_title_idx` ON `job_postings` (`title`);--> statement-breakpoint
CREATE TABLE `problem_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text,
	`category` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`include_debug_content` integer DEFAULT false NOT NULL,
	`debug_expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `problems_project_idx` ON `problem_reports` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_jobs` (
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`job_id` text NOT NULL,
	`cluster_id` text,
	`included` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`run_id`, `job_id`)
);
--> statement-breakpoint
CREATE INDEX `project_jobs_project_idx` ON `project_jobs` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`title` text NOT NULL,
	`target_role` text NOT NULL,
	`input_type` text NOT NULL,
	`input_value` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_user_updated_idx` ON `projects` (`user_email`,`updated_at`);--> statement-breakpoint
CREATE TABLE `report_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`title` text NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_project_version_uidx` ON `report_versions` (`project_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `resume_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`project_id` text NOT NULL,
	`report_version_id` text NOT NULL,
	`language` text NOT NULL,
	`resume_json` text NOT NULL,
	`version_number` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resumes_project_version_uidx` ON `resume_versions` (`project_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `run_stages` (
	`run_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`started_at` text,
	`finished_at` text,
	PRIMARY KEY(`run_id`, `stage`)
);
--> statement-breakpoint
CREATE INDEX `run_stages_status_idx` ON `run_stages` (`status`);--> statement-breakpoint
CREATE TABLE `salary_companies` (
	`company_code` text NOT NULL,
	`year` integer NOT NULL,
	`market` text NOT NULL,
	`company_name` text NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`median_annual_salary` integer,
	`average_annual_salary` integer,
	`source_url` text NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`company_code`, `year`, `market`)
);
--> statement-breakpoint
CREATE INDEX `salary_industry_year_idx` ON `salary_companies` (`industry`,`year`);--> statement-breakpoint
CREATE TABLE `skill_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`job_id` text NOT NULL,
	`normalized_skill` text NOT NULL,
	`raw_keyword` text NOT NULL,
	`requirement_type` text NOT NULL,
	`evidence_text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skill_mentions_run_skill_idx` ON `skill_mentions` (`run_id`,`normalized_skill`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`project_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_user_project_idx` ON `uploads` (`user_email`,`project_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
