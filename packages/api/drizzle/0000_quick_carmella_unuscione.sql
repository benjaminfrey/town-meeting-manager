-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."agenda_item_status" AS ENUM('pending', 'active', 'completed', 'tabled', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'remote', 'excused', 'late_arrival', 'early_departure');--> statement-breakpoint
CREATE TYPE "public"."board_member_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."board_type" AS ENUM('select_board', 'planning_board', 'zoning_board', 'budget_committee', 'conservation_commission', 'parks_recreation', 'harbor_committee', 'shellfish_commission', 'cemetery_committee', 'road_committee', 'comp_plan_committee', 'broadband_committee', 'other');--> statement-breakpoint
CREATE TYPE "public"."exhibit_visibility" AS ENUM('public', 'board_only', 'admin_only');--> statement-breakpoint
CREATE TYPE "public"."meeting_formality" AS ENUM('informal', 'semi_formal', 'formal');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('draft', 'noticed', 'open', 'adjourned', 'minutes_draft', 'approved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."minutes_document_status" AS ENUM('draft', 'review', 'approved', 'published');--> statement-breakpoint
CREATE TYPE "public"."minutes_generated_by" AS ENUM('manual', 'ai', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."minutes_style" AS ENUM('action', 'summary', 'narrative');--> statement-breakpoint
CREATE TYPE "public"."motion_status" AS ENUM('pending', 'seconded', 'in_vote', 'passed', 'failed', 'tabled', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."motion_type" AS ENUM('main', 'amendment', 'substitute', 'table', 'untable', 'postpone', 'reconsider', 'adjourn');--> statement-breakpoint
CREATE TYPE "public"."municipality_type" AS ENUM('town', 'city', 'plantation');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'processing', 'sent', 'delivered', 'failed', 'bounced', 'completed', 'complained');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('sys_admin', 'admin', 'staff', 'board_member');--> statement-breakpoint
CREATE TYPE "public"."vote_type" AS ENUM('yes', 'no', 'abstain', 'recusal', 'absent');--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"seat_title" text,
	"term_start" date NOT NULL,
	"term_end" date,
	"status" "board_member_status" DEFAULT 'active' NOT NULL,
	"is_default_rec_sec" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_member_unique_active" UNIQUE("board_id","person_id","status")
);
--> statement-breakpoint
ALTER TABLE "board_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vote_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"motion_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"board_member_id" uuid NOT NULL,
	"vote" "vote_type" NOT NULL,
	"recusal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_record_unique_per_motion" UNIQUE("board_member_id","motion_id")
);
--> statement-breakpoint
ALTER TABLE "vote_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meeting_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"board_member_id" uuid,
	"person_id" uuid NOT NULL,
	"status" "attendance_status" DEFAULT 'present' NOT NULL,
	"is_recording_secretary" boolean DEFAULT false NOT NULL,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	CONSTRAINT "attendance_unique_per_meeting" UNIQUE("meeting_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "meeting_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "minutes_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minutes_document_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"section_type" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text,
	"content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_agenda_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "minutes_section" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agenda_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid,
	"town_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_name_unique_per_board" UNIQUE("board_id","name")
);
--> statement-breakpoint
ALTER TABLE "agenda_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriber_notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"event_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"consent_timestamp" timestamp with time zone,
	"consent_method" text,
	"consent_record" text,
	CONSTRAINT "subscriber_pref_unique" UNIQUE("channel","event_type","person_id")
);
--> statement-breakpoint
ALTER TABLE "subscriber_notification_preference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "town_notification_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"postmark_server_token_encrypted" text,
	"postmark_sender_email" text,
	"postmark_sender_name" text,
	"twilio_messaging_service_sid" text,
	"twilio_phone_number" text,
	"sms_quiet_hours_start" time DEFAULT '21:00:00',
	"sms_quiet_hours_end" time DEFAULT '08:00:00',
	"sms_opt_in_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "town_notification_config_town_id_key" UNIQUE("town_id")
);
--> statement-breakpoint
ALTER TABLE "town_notification_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "permission_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_name_unique" UNIQUE("name","town_id")
);
--> statement-breakpoint
ALTER TABLE "permission_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"user_account_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "person_email_unique_per_town" UNIQUE("email","town_id")
);
--> statement-breakpoint
ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exhibit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"title" text NOT NULL,
	"file_storage_path" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" bigint,
	"exhibit_type" text,
	"uploaded_by" uuid,
	"visibility" "exhibit_visibility" DEFAULT 'public' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_name" text
);
--> statement-breakpoint
ALTER TABLE "exhibit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "motion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"motion_text" text NOT NULL,
	"motion_type" "motion_type" DEFAULT 'main' NOT NULL,
	"moved_by" uuid,
	"seconded_by" uuid,
	"status" "motion_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_motion_id" uuid,
	"vote_summary" jsonb
);
--> statement-breakpoint
ALTER TABLE "motion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"postmark_message_id" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guest_speaker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agenda_item_id" uuid,
	"town_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"topic" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_speaker" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agenda_item_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agenda_item_transition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "minutes_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"status" "minutes_document_status" DEFAULT 'draft' NOT NULL,
	"content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"html_rendered" text,
	"pdf_storage_path" text,
	"generated_by" "minutes_generated_by" DEFAULT 'manual' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_motion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"board_id" uuid,
	"minutes_style" text DEFAULT 'summary' NOT NULL,
	"submitted_for_review_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"original_content_json" jsonb,
	"amendments_history" jsonb DEFAULT '[]'::jsonb,
	"approved_as_amended" boolean DEFAULT false NOT NULL,
	"search_vector" "tsvector",
	CONSTRAINT "minutes_document_meeting_id_key" UNIQUE("meeting_id")
);
--> statement-breakpoint
ALTER TABLE "minutes_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "executive_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agenda_item_id" uuid,
	"town_id" uuid NOT NULL,
	"statutory_basis" text NOT NULL,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"entry_motion_id" uuid,
	"post_session_action_motion_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executive_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"section_type" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"presenter" text,
	"estimated_duration" integer,
	"parent_item_id" uuid,
	"status" "agenda_item_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_resource" text,
	"background" text,
	"recommendation" text,
	"suggested_motion" text,
	"operator_notes" text,
	"source_minutes_document_id" uuid,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "agenda_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "future_item_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"source_meeting_id" uuid,
	"source_agenda_item_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dismissed_reason" text,
	"placed_agenda_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "future_item_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"name" text NOT NULL,
	"board_type" "board_type" DEFAULT 'other' NOT NULL,
	"member_count" integer,
	"election_method" text,
	"officer_election_method" text,
	"district_based" boolean DEFAULT false NOT NULL,
	"staggered_terms" boolean DEFAULT false NOT NULL,
	"is_governing_board" boolean DEFAULT false NOT NULL,
	"meeting_formality_override" "meeting_formality",
	"minutes_style_override" "minutes_style",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"seat_titles" jsonb DEFAULT '[]'::jsonb,
	"elected_or_appointed" text DEFAULT 'elected',
	"quorum_type" text DEFAULT 'majority',
	"quorum_value" integer,
	"motion_display_format" text DEFAULT 'formal',
	"certification_format" text DEFAULT 'prepared_by' NOT NULL,
	"member_reference_style" text DEFAULT 'title_and_last_name' NOT NULL,
	"notice_template_blocks" jsonb,
	"minutes_consent_agenda" boolean DEFAULT false NOT NULL,
	"minutes_requires_second" boolean DEFAULT true NOT NULL,
	"r4_board_member_default" boolean DEFAULT true NOT NULL,
	"audio_retention_policy_override" text,
	"auto_publish_on_approval_override" boolean,
	CONSTRAINT "board_name_unique_per_town" UNIQUE("name","town_id"),
	CONSTRAINT "board_audio_retention_policy_override_check" CHECK (audio_retention_policy_override = ANY (ARRAY['purge_on_approval'::text, 'retain_30_days'::text, 'retain_90_days'::text, 'retain_indefinitely'::text]))
);
--> statement-breakpoint
ALTER TABLE "board" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"title" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"scheduled_time" time,
	"location" text,
	"status" "meeting_status" DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meeting_type" text DEFAULT 'regular' NOT NULL,
	"formality_override" text,
	"agenda_status" text DEFAULT 'draft' NOT NULL,
	"agenda_packet_url" text,
	"meeting_notice_url" text,
	"agenda_packet_generated_at" timestamp with time zone,
	"meeting_notice_generated_at" timestamp with time zone,
	"current_agenda_item_id" uuid,
	"presiding_officer_id" uuid,
	"recording_secretary_id" uuid,
	"adjournment" jsonb,
	"notice_generated_at" timestamp with time zone,
	"notice_pdf_storage_path" text,
	"notice_published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "meeting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "town" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"state" text DEFAULT 'ME' NOT NULL,
	"municipality_type" "municipality_type" DEFAULT 'town' NOT NULL,
	"population_range" text,
	"contact_name" text,
	"contact_role" text,
	"meeting_formality" "meeting_formality" DEFAULT 'semi_formal' NOT NULL,
	"minutes_style" "minutes_style" DEFAULT 'action' NOT NULL,
	"presiding_officer_default" text,
	"minutes_recorder_default" text,
	"subdomain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_roles_present" jsonb DEFAULT '[]'::jsonb,
	"seal_url" text,
	"retention_policy_acknowledged_at" timestamp with time zone,
	"audio_retention_policy" text DEFAULT 'retain_30_days' NOT NULL,
	"auto_publish_on_approval" boolean DEFAULT false NOT NULL,
	"minutes_review_window_days" integer DEFAULT 7 NOT NULL,
	"minutes_workflow_configured_at" timestamp with time zone,
	CONSTRAINT "town_subdomain_key" UNIQUE("subdomain"),
	CONSTRAINT "town_audio_retention_policy_check" CHECK (audio_retention_policy = ANY (ARRAY['purge_on_approval'::text, 'retain_30_days'::text, 'retain_90_days'::text, 'retain_indefinitely'::text]))
);
--> statement-breakpoint
ALTER TABLE "town" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "minutes_addendum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minutes_document_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"adopting_meeting_id" uuid NOT NULL,
	"adopting_motion_id" uuid,
	"content_json" jsonb NOT NULL,
	"html_rendered" text,
	"description" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "minutes_addendum" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_account_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_user_account_id_endpoint_key" UNIQUE("endpoint","user_account_id")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"user_account_id" uuid,
	"town_id" uuid NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"email" text,
	"role" text,
	"invited_by" uuid,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_key" UNIQUE("token"),
	CONSTRAINT "invitation_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"gov_title" text,
	"permissions" jsonb DEFAULT '{"global":{},"board_overrides":[]}'::jsonb NOT NULL,
	"auth_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"notification_preferences" jsonb DEFAULT '{}'::jsonb,
	"email" text,
	"display_name" text,
	"email_bounced" boolean DEFAULT false NOT NULL,
	"email_bounced_at" timestamp with time zone,
	"email_complained" boolean DEFAULT false NOT NULL,
	"email_complained_at" timestamp with time zone,
	CONSTRAINT "user_account_person_id_key" UNIQUE("person_id"),
	CONSTRAINT "user_account_auth_user_id_key" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "user_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_record" ADD CONSTRAINT "vote_record_motion_id_fkey" FOREIGN KEY ("motion_id") REFERENCES "public"."motion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_record" ADD CONSTRAINT "vote_record_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_record" ADD CONSTRAINT "vote_record_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_record" ADD CONSTRAINT "vote_record_board_member_id_fkey" FOREIGN KEY ("board_member_id") REFERENCES "public"."board_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_board_member_id_fkey" FOREIGN KEY ("board_member_id") REFERENCES "public"."board_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_section" ADD CONSTRAINT "minutes_section_minutes_document_id_fkey" FOREIGN KEY ("minutes_document_id") REFERENCES "public"."minutes_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_section" ADD CONSTRAINT "minutes_section_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_section" ADD CONSTRAINT "minutes_section_source_agenda_item_id_fkey" FOREIGN KEY ("source_agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_template" ADD CONSTRAINT "agenda_template_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_template" ADD CONSTRAINT "agenda_template_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_notification_preference" ADD CONSTRAINT "subscriber_notification_preference_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_notification_preference" ADD CONSTRAINT "subscriber_notification_preference_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "town_notification_config" ADD CONSTRAINT "town_notification_config_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_template" ADD CONSTRAINT "permission_template_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit" ADD CONSTRAINT "exhibit_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit" ADD CONSTRAINT "exhibit_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit" ADD CONSTRAINT "exhibit_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion" ADD CONSTRAINT "motion_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion" ADD CONSTRAINT "motion_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion" ADD CONSTRAINT "motion_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion" ADD CONSTRAINT "motion_moved_by_fkey" FOREIGN KEY ("moved_by") REFERENCES "public"."board_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion" ADD CONSTRAINT "motion_seconded_by_fkey" FOREIGN KEY ("seconded_by") REFERENCES "public"."board_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion" ADD CONSTRAINT "motion_parent_motion_id_fkey" FOREIGN KEY ("parent_motion_id") REFERENCES "public"."motion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."notification_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_speaker" ADD CONSTRAINT "guest_speaker_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_speaker" ADD CONSTRAINT "guest_speaker_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_speaker" ADD CONSTRAINT "guest_speaker_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item_transition" ADD CONSTRAINT "agenda_item_transition_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item_transition" ADD CONSTRAINT "agenda_item_transition_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item_transition" ADD CONSTRAINT "agenda_item_transition_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_document" ADD CONSTRAINT "minutes_document_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_document" ADD CONSTRAINT "minutes_document_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_document" ADD CONSTRAINT "minutes_document_approved_by_motion_id_fkey" FOREIGN KEY ("approved_by_motion_id") REFERENCES "public"."motion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_document" ADD CONSTRAINT "minutes_document_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_document" ADD CONSTRAINT "minutes_document_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_session" ADD CONSTRAINT "executive_session_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_session" ADD CONSTRAINT "executive_session_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_session" ADD CONSTRAINT "executive_session_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_session" ADD CONSTRAINT "executive_session_entry_motion_id_fkey" FOREIGN KEY ("entry_motion_id") REFERENCES "public"."motion"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_source_minutes_document_id_fkey" FOREIGN KEY ("source_minutes_document_id") REFERENCES "public"."minutes_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "future_item_queue" ADD CONSTRAINT "future_item_queue_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "future_item_queue" ADD CONSTRAINT "future_item_queue_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "future_item_queue" ADD CONSTRAINT "future_item_queue_source_meeting_id_fkey" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meeting"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "future_item_queue" ADD CONSTRAINT "future_item_queue_source_agenda_item_id_fkey" FOREIGN KEY ("source_agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "future_item_queue" ADD CONSTRAINT "future_item_queue_placed_agenda_item_id_fkey" FOREIGN KEY ("placed_agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_current_agenda_item_id_fkey" FOREIGN KEY ("current_agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_presiding_officer_id_fkey" FOREIGN KEY ("presiding_officer_id") REFERENCES "public"."board_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_addendum" ADD CONSTRAINT "minutes_addendum_minutes_document_id_fkey" FOREIGN KEY ("minutes_document_id") REFERENCES "public"."minutes_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_addendum" ADD CONSTRAINT "minutes_addendum_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_addendum" ADD CONSTRAINT "minutes_addendum_adopting_meeting_id_fkey" FOREIGN KEY ("adopting_meeting_id") REFERENCES "public"."meeting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_addendum" ADD CONSTRAINT "minutes_addendum_adopting_motion_id_fkey" FOREIGN KEY ("adopting_motion_id") REFERENCES "public"."motion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_addendum" ADD CONSTRAINT "minutes_addendum_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "public"."town"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_board_member_active" ON "board_member" USING btree ("board_id" uuid_ops,"status" uuid_ops) WHERE (status = 'active'::board_member_status);--> statement-breakpoint
CREATE INDEX "idx_board_member_board_id" ON "board_member" USING btree ("board_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_board_member_person_id" ON "board_member" USING btree ("person_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_board_member_town_id" ON "board_member" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_vote_record_board_member_id" ON "vote_record" USING btree ("board_member_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_vote_record_meeting_id" ON "vote_record" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_vote_record_motion_id" ON "vote_record" USING btree ("motion_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_vote_record_town_id" ON "vote_record" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_attendance_board_member_id" ON "meeting_attendance" USING btree ("board_member_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_attendance_meeting_id" ON "meeting_attendance" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_attendance_person_id" ON "meeting_attendance" USING btree ("person_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_attendance_town_id" ON "meeting_attendance" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_section_doc_id" ON "minutes_section" USING btree ("minutes_document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_section_sort" ON "minutes_section" USING btree ("minutes_document_id" uuid_ops,"sort_order" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_section_town_id" ON "minutes_section" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_template_board_id" ON "agenda_template" USING btree ("board_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_template_town_id" ON "agenda_template" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_event_status" ON "notification_event" USING btree ("status" enum_ops) WHERE (status = ANY (ARRAY['pending'::notification_status, 'processing'::notification_status]));--> statement-breakpoint
CREATE INDEX "idx_notification_event_town_id" ON "notification_event" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_event_type" ON "notification_event" USING btree ("town_id" uuid_ops,"event_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_subscriber_pref_person" ON "subscriber_notification_preference" USING btree ("person_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_subscriber_pref_town" ON "subscriber_notification_preference" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_permission_template_town" ON "permission_template" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_created" ON "audit_log" USING btree ("town_id" uuid_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type" uuid_ops,"entity_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_town_id" ON "audit_log" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_user" ON "audit_log" USING btree ("user_account_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_person_archived" ON "person" USING btree ("town_id" uuid_ops) WHERE (archived_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_person_email" ON "person" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "idx_person_town_id" ON "person" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_exhibit_agenda_item_id" ON "exhibit" USING btree ("agenda_item_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_exhibit_town_id" ON "exhibit" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_exhibit_uploaded_by" ON "exhibit" USING btree ("uploaded_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_motion_agenda_item_id" ON "motion" USING btree ("agenda_item_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_motion_meeting_id" ON "motion" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_motion_moved_by" ON "motion" USING btree ("moved_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_motion_parent" ON "motion" USING btree ("parent_motion_id" uuid_ops) WHERE (parent_motion_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_motion_status" ON "motion" USING btree ("meeting_id" uuid_ops,"status" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_motion_town_id" ON "motion" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_delivery_event_id" ON "notification_delivery" USING btree ("event_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_delivery_postmark" ON "notification_delivery" USING btree ("postmark_message_id" text_ops) WHERE (postmark_message_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_notification_delivery_retry" ON "notification_delivery" USING btree ("next_retry_at" timestamptz_ops) WHERE ((status = ANY (ARRAY['sent'::notification_status, 'failed'::notification_status])) AND (retry_count < 3) AND (next_retry_at IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_notification_delivery_status" ON "notification_delivery" USING btree ("status" enum_ops) WHERE (status = ANY (ARRAY['pending'::notification_status, 'processing'::notification_status]));--> statement-breakpoint
CREATE INDEX "idx_notification_delivery_subscriber" ON "notification_delivery" USING btree ("subscriber_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_delivery_town_id" ON "notification_delivery" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_guest_speaker_meeting" ON "guest_speaker" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_guest_speaker_town" ON "guest_speaker" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_transition_item" ON "agenda_item_transition" USING btree ("agenda_item_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_transition_meeting" ON "agenda_item_transition" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_transition_town" ON "agenda_item_transition" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_doc_meeting_id" ON "minutes_document" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_doc_status" ON "minutes_document" USING btree ("town_id" uuid_ops,"status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_doc_town_id" ON "minutes_document" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_document_board_id" ON "minutes_document" USING btree ("board_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_document_search" ON "minutes_document" USING gin ("search_vector" tsvector_ops);--> statement-breakpoint
CREATE INDEX "idx_executive_session_meeting" ON "executive_session" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_executive_session_town" ON "executive_session" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_meeting_id" ON "agenda_item" USING btree ("meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_parent" ON "agenda_item" USING btree ("parent_item_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_search" ON "agenda_item" USING gin ("search_vector" tsvector_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_sort" ON "agenda_item" USING btree ("meeting_id" uuid_ops,"sort_order" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_source_minutes_doc" ON "agenda_item" USING btree ("source_minutes_document_id" uuid_ops) WHERE (source_minutes_document_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_agenda_item_town_id" ON "agenda_item" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_future_item_queue_board" ON "future_item_queue" USING btree ("board_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_future_item_queue_source_meeting" ON "future_item_queue" USING btree ("source_meeting_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_future_item_queue_town" ON "future_item_queue" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_board_town_id" ON "board" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_board_type" ON "board" USING btree ("town_id" uuid_ops,"board_type" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_meeting_board_id" ON "meeting" USING btree ("board_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_meeting_created_by" ON "meeting" USING btree ("created_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_meeting_date" ON "meeting" USING btree ("town_id" date_ops,"scheduled_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_meeting_status" ON "meeting" USING btree ("town_id" enum_ops,"status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_meeting_town_id" ON "meeting" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_addendum_document" ON "minutes_addendum" USING btree ("minutes_document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_minutes_addendum_town" ON "minutes_addendum" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_push_subscription_user" ON "push_subscription" USING btree ("user_account_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_invitation_person_status" ON "invitation" USING btree ("person_id" uuid_ops,"status" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_invitation_token" ON "invitation" USING btree ("token" text_ops) WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "idx_user_account_auth_user_id" ON "user_account" USING btree ("auth_user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_user_account_person_id" ON "user_account" USING btree ("person_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_user_account_role" ON "user_account" USING btree ("town_id" uuid_ops,"role" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_user_account_town_id" ON "user_account" USING btree ("town_id" uuid_ops);--> statement-breakpoint
CREATE POLICY "board_member_update" ON "board_member" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "board_member_insert" ON "board_member" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "board_member_select" ON "board_member" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "vote_record_update" ON "vote_record" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND has_permission('M3'::text)));--> statement-breakpoint
CREATE POLICY "vote_record_insert" ON "vote_record" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "vote_record_select" ON "vote_record" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "attendance_update" ON "meeting_attendance" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND has_permission('M2'::text)));--> statement-breakpoint
CREATE POLICY "attendance_insert" ON "meeting_attendance" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "attendance_select" ON "meeting_attendance" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "minutes_section_update" ON "minutes_section" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND has_permission('R1'::text)));--> statement-breakpoint
CREATE POLICY "minutes_section_insert" ON "minutes_section" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "minutes_section_select" ON "minutes_section" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "agenda_template_delete" ON "agenda_template" AS PERMISSIVE FOR DELETE TO public USING (((town_id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "agenda_template_update" ON "agenda_template" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "agenda_template_insert" ON "agenda_template" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "agenda_template_select" ON "agenda_template" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "notification_event_insert" ON "notification_event" AS PERMISSIVE FOR INSERT TO public WITH CHECK (((town_id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "notification_event_select" ON "notification_event" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "subscriber_pref_update" ON "subscriber_notification_preference" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND ((person_id = get_current_person_id()) OR is_admin())));--> statement-breakpoint
CREATE POLICY "subscriber_pref_insert" ON "subscriber_notification_preference" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "subscriber_pref_select" ON "subscriber_notification_preference" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "town_notification_config_update" ON "town_notification_config" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "town_notification_config_insert" ON "town_notification_config" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "town_notification_config_select" ON "town_notification_config" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "permission_template_delete" ON "permission_template" AS PERMISSIVE FOR DELETE TO public USING (((town_id = get_current_town_id()) AND is_admin() AND (is_system_default = false)));--> statement-breakpoint
CREATE POLICY "permission_template_update" ON "permission_template" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "permission_template_insert" ON "permission_template" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "permission_template_select" ON "permission_template" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "audit_log_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((town_id = get_current_town_id()));--> statement-breakpoint
CREATE POLICY "audit_log_select" ON "audit_log" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "person_update" ON "person" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "person_insert" ON "person" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "person_select" ON "person" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "exhibit_update" ON "exhibit" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND has_permission('A3'::text)));--> statement-breakpoint
CREATE POLICY "exhibit_insert" ON "exhibit" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "exhibit_select" ON "exhibit" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "motion_update" ON "motion" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND has_permission('M3'::text)));--> statement-breakpoint
CREATE POLICY "motion_insert" ON "motion" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "motion_select" ON "motion" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "notification_delivery_insert" ON "notification_delivery" AS PERMISSIVE FOR INSERT TO public WITH CHECK (((town_id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "notification_delivery_select" ON "notification_delivery" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "guest_speaker_delete" ON "guest_speaker" AS PERMISSIVE FOR DELETE TO public USING ((town_id = get_current_town_id()));--> statement-breakpoint
CREATE POLICY "guest_speaker_insert" ON "guest_speaker" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "guest_speaker_select" ON "guest_speaker" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "transition_insert" ON "agenda_item_transition" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((town_id = get_current_town_id()));--> statement-breakpoint
CREATE POLICY "transition_select" ON "agenda_item_transition" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "transition_update" ON "agenda_item_transition" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "minutes_document_update" ON "minutes_document" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND has_permission('R1'::text)));--> statement-breakpoint
CREATE POLICY "minutes_document_insert" ON "minutes_document" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "minutes_document_select" ON "minutes_document" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "executive_session_delete" ON "executive_session" AS PERMISSIVE FOR DELETE TO public USING ((town_id = ( SELECT ((((current_setting('request.jwt.claims'::text, true))::jsonb -> 'app_metadata'::text) ->> 'town_id'::text))::uuid AS uuid)));--> statement-breakpoint
CREATE POLICY "executive_session_update" ON "executive_session" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "executive_session_insert" ON "executive_session" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "executive_session_select" ON "executive_session" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "agenda_item_update" ON "agenda_item" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND has_permission('A2'::text)));--> statement-breakpoint
CREATE POLICY "agenda_item_insert" ON "agenda_item" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "agenda_item_select" ON "agenda_item" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "future_item_queue_delete" ON "future_item_queue" AS PERMISSIVE FOR DELETE TO public USING ((town_id = ( SELECT ((((current_setting('request.jwt.claims'::text, true))::jsonb -> 'app_metadata'::text) ->> 'town_id'::text))::uuid AS uuid)));--> statement-breakpoint
CREATE POLICY "future_item_queue_update" ON "future_item_queue" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "future_item_queue_insert" ON "future_item_queue" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "future_item_queue_select" ON "future_item_queue" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "board_update" ON "board" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "board_insert" ON "board" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "board_select" ON "board" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "meeting_update" ON "meeting" AS PERMISSIVE FOR UPDATE TO public USING (((town_id = get_current_town_id()) AND (is_admin() OR has_board_permission('A1'::text, board_id) OR has_board_permission('M1'::text, board_id))));--> statement-breakpoint
CREATE POLICY "meeting_insert" ON "meeting" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "meeting_select" ON "meeting" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "town_update" ON "town" AS PERMISSIVE FOR UPDATE TO public USING (((id = get_current_town_id()) AND is_admin()));--> statement-breakpoint
CREATE POLICY "town_select" ON "town" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Authenticated users can update addenda for their town" ON "minutes_addendum" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((town_id IN ( SELECT ua.town_id
   FROM user_account ua
  WHERE (ua.id = auth.uid()))));--> statement-breakpoint
CREATE POLICY "Authenticated users can insert addenda for their town" ON "minutes_addendum" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Authenticated users can read addenda for their town" ON "minutes_addendum" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "town_members_update_invitations" ON "invitation" AS PERMISSIVE FOR UPDATE TO public USING ((town_id IN ( SELECT user_account.town_id
   FROM user_account
  WHERE (user_account.auth_user_id = auth.uid()))));--> statement-breakpoint
CREATE POLICY "town_members_insert_invitations" ON "invitation" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "town_members_see_invitations" ON "invitation" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "user_account_update_own" ON "user_account" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((person_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "user_account_update" ON "user_account" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "user_account_insert" ON "user_account" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "user_account_select" ON "user_account" AS PERMISSIVE FOR SELECT TO public;
*/