export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agenda_item: {
        Row: {
          background: string | null
          created_at: string
          description: string | null
          estimated_duration: number | null
          id: string
          meeting_id: string
          operator_notes: string | null
          parent_item_id: string | null
          presenter: string | null
          recommendation: string | null
          section_type: string
          sort_order: number
          staff_resource: string | null
          status: Database["public"]["Enums"]["agenda_item_status"]
          suggested_motion: string | null
          title: string
          town_id: string
          updated_at: string
        }
        Insert: {
          background?: string | null
          created_at?: string
          description?: string | null
          estimated_duration?: number | null
          id?: string
          meeting_id: string
          operator_notes?: string | null
          parent_item_id?: string | null
          presenter?: string | null
          recommendation?: string | null
          section_type: string
          sort_order?: number
          staff_resource?: string | null
          status?: Database["public"]["Enums"]["agenda_item_status"]
          suggested_motion?: string | null
          title: string
          town_id: string
          updated_at?: string
        }
        Update: {
          background?: string | null
          created_at?: string
          description?: string | null
          estimated_duration?: number | null
          id?: string
          meeting_id?: string
          operator_notes?: string | null
          parent_item_id?: string | null
          presenter?: string | null
          recommendation?: string | null
          section_type?: string
          sort_order?: number
          staff_resource?: string | null
          status?: Database["public"]["Enums"]["agenda_item_status"]
          suggested_motion?: string | null
          title?: string
          town_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_item_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_item_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_item_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_item_transition: {
        Row: {
          agenda_item_id: string
          ended_at: string | null
          id: string
          meeting_id: string
          started_at: string
          town_id: string
        }
        Insert: {
          agenda_item_id: string
          ended_at?: string | null
          id?: string
          meeting_id: string
          started_at?: string
          town_id: string
        }
        Update: {
          agenda_item_id?: string
          ended_at?: string | null
          id?: string
          meeting_id?: string
          started_at?: string
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_item_transition_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_item_transition_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_item_transition_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_template: {
        Row: {
          board_id: string | null
          created_at: string
          id: string
          is_default: boolean
          name: string
          sections: Json
          town_id: string
          updated_at: string
        }
        Insert: {
          board_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          sections?: Json
          town_id: string
          updated_at?: string
        }
        Update: {
          board_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          sections?: Json
          town_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_template_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_template_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          town_id: string
          user_account_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          town_id: string
          user_account_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          town_id?: string
          user_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_account_id_fkey"
            columns: ["user_account_id"]
            isOneToOne: false
            referencedRelation: "user_account"
            referencedColumns: ["id"]
          },
        ]
      }
      board: {
        Row: {
          archived_at: string | null
          audio_retention_policy_override: string | null
          auto_publish_on_approval_override: boolean | null
          board_type: Database["public"]["Enums"]["board_type"]
          created_at: string
          district_based: boolean
          elected_or_appointed: string | null
          election_method: string | null
          id: string
          is_governing_board: boolean
          meeting_formality_override:
            | Database["public"]["Enums"]["meeting_formality"]
            | null
          member_count: number | null
          minutes_consent_agenda: boolean
          minutes_requires_second: boolean
          minutes_style_override:
            | Database["public"]["Enums"]["minutes_style"]
            | null
          motion_display_format: string | null
          name: string
          notice_template_blocks: Json | null
          officer_election_method: string | null
          quorum_type: string | null
          quorum_value: number | null
          r4_board_member_default: boolean
          seat_titles: Json | null
          staggered_terms: boolean
          town_id: string
        }
        Insert: {
          archived_at?: string | null
          audio_retention_policy_override?: string | null
          auto_publish_on_approval_override?: boolean | null
          board_type?: Database["public"]["Enums"]["board_type"]
          created_at?: string
          district_based?: boolean
          elected_or_appointed?: string | null
          election_method?: string | null
          id?: string
          is_governing_board?: boolean
          meeting_formality_override?:
            | Database["public"]["Enums"]["meeting_formality"]
            | null
          member_count?: number | null
          minutes_consent_agenda?: boolean
          minutes_requires_second?: boolean
          minutes_style_override?:
            | Database["public"]["Enums"]["minutes_style"]
            | null
          motion_display_format?: string | null
          name: string
          notice_template_blocks?: Json | null
          officer_election_method?: string | null
          quorum_type?: string | null
          quorum_value?: number | null
          r4_board_member_default?: boolean
          seat_titles?: Json | null
          staggered_terms?: boolean
          town_id: string
        }
        Update: {
          archived_at?: string | null
          audio_retention_policy_override?: string | null
          auto_publish_on_approval_override?: boolean | null
          board_type?: Database["public"]["Enums"]["board_type"]
          created_at?: string
          district_based?: boolean
          elected_or_appointed?: string | null
          election_method?: string | null
          id?: string
          is_governing_board?: boolean
          meeting_formality_override?:
            | Database["public"]["Enums"]["meeting_formality"]
            | null
          member_count?: number | null
          minutes_consent_agenda?: boolean
          minutes_requires_second?: boolean
          minutes_style_override?:
            | Database["public"]["Enums"]["minutes_style"]
            | null
          motion_display_format?: string | null
          name?: string
          notice_template_blocks?: Json | null
          officer_election_method?: string | null
          quorum_type?: string | null
          quorum_value?: number | null
          r4_board_member_default?: boolean
          seat_titles?: Json | null
          staggered_terms?: boolean
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      board_member: {
        Row: {
          board_id: string
          created_at: string
          id: string
          is_default_rec_sec: boolean
          person_id: string
          seat_title: string | null
          status: Database["public"]["Enums"]["board_member_status"]
          term_end: string | null
          term_start: string
          town_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          is_default_rec_sec?: boolean
          person_id: string
          seat_title?: string | null
          status?: Database["public"]["Enums"]["board_member_status"]
          term_end?: string | null
          term_start: string
          town_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          is_default_rec_sec?: boolean
          person_id?: string
          seat_title?: string | null
          status?: Database["public"]["Enums"]["board_member_status"]
          term_end?: string | null
          term_start?: string
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_member_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_member_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_member_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      executive_session: {
        Row: {
          agenda_item_id: string | null
          created_at: string
          entered_at: string | null
          entry_motion_id: string | null
          exited_at: string | null
          id: string
          meeting_id: string
          post_session_action_motion_ids: Json | null
          statutory_basis: string
          town_id: string
        }
        Insert: {
          agenda_item_id?: string | null
          created_at?: string
          entered_at?: string | null
          entry_motion_id?: string | null
          exited_at?: string | null
          id?: string
          meeting_id: string
          post_session_action_motion_ids?: Json | null
          statutory_basis: string
          town_id: string
        }
        Update: {
          agenda_item_id?: string | null
          created_at?: string
          entered_at?: string | null
          entry_motion_id?: string | null
          exited_at?: string | null
          id?: string
          meeting_id?: string
          post_session_action_motion_ids?: Json | null
          statutory_basis?: string
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "executive_session_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executive_session_entry_motion_id_fkey"
            columns: ["entry_motion_id"]
            isOneToOne: false
            referencedRelation: "motion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executive_session_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executive_session_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      exhibit: {
        Row: {
          agenda_item_id: string
          created_at: string
          exhibit_type: string | null
          file_name: string | null
          file_size: number | null
          file_storage_path: string
          file_type: string
          id: string
          sort_order: number
          title: string
          town_id: string
          uploaded_by: string | null
          visibility: Database["public"]["Enums"]["exhibit_visibility"]
        }
        Insert: {
          agenda_item_id: string
          created_at?: string
          exhibit_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_storage_path: string
          file_type: string
          id?: string
          sort_order?: number
          title: string
          town_id: string
          uploaded_by?: string | null
          visibility?: Database["public"]["Enums"]["exhibit_visibility"]
        }
        Update: {
          agenda_item_id?: string
          created_at?: string
          exhibit_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_storage_path?: string
          file_type?: string
          id?: string
          sort_order?: number
          title?: string
          town_id?: string
          uploaded_by?: string | null
          visibility?: Database["public"]["Enums"]["exhibit_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "exhibit_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exhibit_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exhibit_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_account"
            referencedColumns: ["id"]
          },
        ]
      }
      future_item_queue: {
        Row: {
          board_id: string
          created_at: string
          description: string | null
          dismissed_reason: string | null
          id: string
          placed_agenda_item_id: string | null
          source: string
          source_agenda_item_id: string | null
          source_meeting_id: string | null
          status: string
          title: string
          town_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          description?: string | null
          dismissed_reason?: string | null
          id?: string
          placed_agenda_item_id?: string | null
          source: string
          source_agenda_item_id?: string | null
          source_meeting_id?: string | null
          status?: string
          title: string
          town_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          description?: string | null
          dismissed_reason?: string | null
          id?: string
          placed_agenda_item_id?: string | null
          source?: string
          source_agenda_item_id?: string | null
          source_meeting_id?: string | null
          status?: string
          title?: string
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_item_queue_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_item_queue_placed_agenda_item_id_fkey"
            columns: ["placed_agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_item_queue_source_agenda_item_id_fkey"
            columns: ["source_agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_item_queue_source_meeting_id_fkey"
            columns: ["source_meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_item_queue_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_speaker: {
        Row: {
          address: string | null
          agenda_item_id: string | null
          created_at: string
          id: string
          meeting_id: string
          name: string
          topic: string | null
          town_id: string
        }
        Insert: {
          address?: string | null
          agenda_item_id?: string | null
          created_at?: string
          id?: string
          meeting_id: string
          name: string
          topic?: string | null
          town_id: string
        }
        Update: {
          address?: string | null
          agenda_item_id?: string | null
          created_at?: string
          id?: string
          meeting_id?: string
          name?: string
          topic?: string | null
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_speaker_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_speaker_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_speaker_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string | null
          expires_at: string | null
          id: string
          invited_by: string | null
          person_id: string
          role: string | null
          sent_at: string | null
          status: string
          token: string
          town_id: string
          user_account_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          person_id: string
          role?: string | null
          sent_at?: string | null
          status?: string
          token: string
          town_id: string
          user_account_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          person_id?: string
          role?: string | null
          sent_at?: string | null
          status?: string
          token?: string
          town_id?: string
          user_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitation_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "user_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_user_account_id_fkey"
            columns: ["user_account_id"]
            isOneToOne: false
            referencedRelation: "user_account"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting: {
        Row: {
          adjournment: Json | null
          agenda_status: string
          board_id: string
          created_at: string
          created_by: string | null
          current_agenda_item_id: string | null
          ended_at: string | null
          formality_override: string | null
          id: string
          location: string | null
          meeting_type: string
          notice_generated_at: string | null
          notice_pdf_storage_path: string | null
          notice_published_at: string | null
          presiding_officer_id: string | null
          recording_secretary_id: string | null
          scheduled_date: string
          scheduled_time: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["meeting_status"]
          title: string
          town_id: string
          updated_at: string
        }
        Insert: {
          adjournment?: Json | null
          agenda_status?: string
          board_id: string
          created_at?: string
          created_by?: string | null
          current_agenda_item_id?: string | null
          ended_at?: string | null
          formality_override?: string | null
          id?: string
          location?: string | null
          meeting_type?: string
          notice_generated_at?: string | null
          notice_pdf_storage_path?: string | null
          notice_published_at?: string | null
          presiding_officer_id?: string | null
          recording_secretary_id?: string | null
          scheduled_date: string
          scheduled_time?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["meeting_status"]
          title: string
          town_id: string
          updated_at?: string
        }
        Update: {
          adjournment?: Json | null
          agenda_status?: string
          board_id?: string
          created_at?: string
          created_by?: string | null
          current_agenda_item_id?: string | null
          ended_at?: string | null
          formality_override?: string | null
          id?: string
          location?: string | null
          meeting_type?: string
          notice_generated_at?: string | null
          notice_pdf_storage_path?: string | null
          notice_published_at?: string | null
          presiding_officer_id?: string | null
          recording_secretary_id?: string | null
          scheduled_date?: string
          scheduled_time?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["meeting_status"]
          title?: string
          town_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_current_agenda_item_id_fkey"
            columns: ["current_agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_presiding_officer_id_fkey"
            columns: ["presiding_officer_id"]
            isOneToOne: false
            referencedRelation: "board_member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_attendance: {
        Row: {
          arrived_at: string | null
          board_member_id: string | null
          departed_at: string | null
          id: string
          is_recording_secretary: boolean
          meeting_id: string
          person_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          town_id: string
        }
        Insert: {
          arrived_at?: string | null
          board_member_id?: string | null
          departed_at?: string | null
          id?: string
          is_recording_secretary?: boolean
          meeting_id: string
          person_id: string
          status?: Database["public"]["Enums"]["attendance_status"]
          town_id: string
        }
        Update: {
          arrived_at?: string | null
          board_member_id?: string | null
          departed_at?: string | null
          id?: string
          is_recording_secretary?: boolean
          meeting_id?: string
          person_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_attendance_board_member_id_fkey"
            columns: ["board_member_id"]
            isOneToOne: false
            referencedRelation: "board_member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendance_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendance_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendance_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      minutes_addendum: {
        Row: {
          adopting_meeting_id: string
          adopting_motion_id: string | null
          content_json: Json
          created_at: string
          created_by: string | null
          description: string
          html_rendered: string | null
          id: string
          minutes_document_id: string
          published_at: string | null
          town_id: string
        }
        Insert: {
          adopting_meeting_id: string
          adopting_motion_id?: string | null
          content_json: Json
          created_at?: string
          created_by?: string | null
          description: string
          html_rendered?: string | null
          id?: string
          minutes_document_id: string
          published_at?: string | null
          town_id: string
        }
        Update: {
          adopting_meeting_id?: string
          adopting_motion_id?: string | null
          content_json?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          html_rendered?: string | null
          id?: string
          minutes_document_id?: string
          published_at?: string | null
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "minutes_addendum_adopting_meeting_id_fkey"
            columns: ["adopting_meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_addendum_adopting_motion_id_fkey"
            columns: ["adopting_motion_id"]
            isOneToOne: false
            referencedRelation: "motion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_addendum_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_addendum_minutes_document_id_fkey"
            columns: ["minutes_document_id"]
            isOneToOne: false
            referencedRelation: "minutes_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_addendum_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      minutes_document: {
        Row: {
          approved_at: string | null
          approved_by_motion_id: string | null
          content_json: Json
          created_at: string
          generated_by: Database["public"]["Enums"]["minutes_generated_by"]
          html_rendered: string | null
          id: string
          meeting_id: string
          pdf_storage_path: string | null
          status: Database["public"]["Enums"]["minutes_document_status"]
          town_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by_motion_id?: string | null
          content_json?: Json
          created_at?: string
          generated_by?: Database["public"]["Enums"]["minutes_generated_by"]
          html_rendered?: string | null
          id?: string
          meeting_id: string
          pdf_storage_path?: string | null
          status?: Database["public"]["Enums"]["minutes_document_status"]
          town_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by_motion_id?: string | null
          content_json?: Json
          created_at?: string
          generated_by?: Database["public"]["Enums"]["minutes_generated_by"]
          html_rendered?: string | null
          id?: string
          meeting_id?: string
          pdf_storage_path?: string | null
          status?: Database["public"]["Enums"]["minutes_document_status"]
          town_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "minutes_document_approved_by_motion_id_fkey"
            columns: ["approved_by_motion_id"]
            isOneToOne: false
            referencedRelation: "motion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_document_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_document_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      minutes_section: {
        Row: {
          content_json: Json
          created_at: string
          id: string
          minutes_document_id: string
          section_type: string
          sort_order: number
          source_agenda_item_id: string | null
          title: string | null
          town_id: string
          updated_at: string
        }
        Insert: {
          content_json?: Json
          created_at?: string
          id?: string
          minutes_document_id: string
          section_type: string
          sort_order?: number
          source_agenda_item_id?: string | null
          title?: string | null
          town_id: string
          updated_at?: string
        }
        Update: {
          content_json?: Json
          created_at?: string
          id?: string
          minutes_document_id?: string
          section_type?: string
          sort_order?: number
          source_agenda_item_id?: string | null
          title?: string | null
          town_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "minutes_section_minutes_document_id_fkey"
            columns: ["minutes_document_id"]
            isOneToOne: false
            referencedRelation: "minutes_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_section_source_agenda_item_id_fkey"
            columns: ["source_agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minutes_section_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      motion: {
        Row: {
          agenda_item_id: string
          created_at: string
          id: string
          meeting_id: string
          motion_text: string
          motion_type: Database["public"]["Enums"]["motion_type"]
          moved_by: string | null
          parent_motion_id: string | null
          seconded_by: string | null
          status: Database["public"]["Enums"]["motion_status"]
          town_id: string
          vote_summary: Json | null
        }
        Insert: {
          agenda_item_id: string
          created_at?: string
          id?: string
          meeting_id: string
          motion_text: string
          motion_type?: Database["public"]["Enums"]["motion_type"]
          moved_by?: string | null
          parent_motion_id?: string | null
          seconded_by?: string | null
          status?: Database["public"]["Enums"]["motion_status"]
          town_id: string
          vote_summary?: Json | null
        }
        Update: {
          agenda_item_id?: string
          created_at?: string
          id?: string
          meeting_id?: string
          motion_text?: string
          motion_type?: Database["public"]["Enums"]["motion_type"]
          moved_by?: string | null
          parent_motion_id?: string | null
          seconded_by?: string | null
          status?: Database["public"]["Enums"]["motion_status"]
          town_id?: string
          vote_summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "motion_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motion_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motion_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "board_member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motion_parent_motion_id_fkey"
            columns: ["parent_motion_id"]
            isOneToOne: false
            referencedRelation: "motion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motion_seconded_by_fkey"
            columns: ["seconded_by"]
            isOneToOne: false
            referencedRelation: "board_member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motion_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          delivered_at: string | null
          error_message: string | null
          event_id: string
          external_id: string | null
          id: string
          next_retry_at: string | null
          opened_at: string | null
          postmark_message_id: string | null
          retry_count: number
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          subscriber_id: string
          town_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          event_id: string
          external_id?: string | null
          id?: string
          next_retry_at?: string | null
          opened_at?: string | null
          postmark_message_id?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          subscriber_id: string
          town_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          event_id?: string
          external_id?: string | null
          id?: string
          next_retry_at?: string | null
          opened_at?: string | null
          postmark_message_id?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          subscriber_id?: string
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_event"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_event: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          town_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          town_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_event_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_template: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system_default: boolean
          name: string
          permissions: Json
          town_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_default?: boolean
          name: string
          permissions?: Json
          town_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_default?: boolean
          name?: string
          permissions?: Json
          town_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_template_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      person: {
        Row: {
          archived_at: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          town_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          town_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      subscriber_notification_preference: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          consent_method: string | null
          consent_record: string | null
          consent_timestamp: string | null
          enabled: boolean
          event_type: string
          id: string
          person_id: string
          town_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          consent_method?: string | null
          consent_record?: string | null
          consent_timestamp?: string | null
          enabled?: boolean
          event_type: string
          id?: string
          person_id: string
          town_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          consent_method?: string | null
          consent_record?: string | null
          consent_timestamp?: string | null
          enabled?: boolean
          event_type?: string
          id?: string
          person_id?: string
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriber_notification_preference_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriber_notification_preference_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      town: {
        Row: {
          audio_retention_policy: string
          auto_publish_on_approval: boolean
          contact_name: string | null
          contact_role: string | null
          created_at: string
          id: string
          meeting_formality: Database["public"]["Enums"]["meeting_formality"]
          minutes_recorder_default: string | null
          minutes_review_window_days: number
          minutes_style: Database["public"]["Enums"]["minutes_style"]
          minutes_workflow_configured_at: string | null
          municipality_type: Database["public"]["Enums"]["municipality_type"]
          name: string
          population_range: string | null
          presiding_officer_default: string | null
          retention_policy_acknowledged_at: string | null
          seal_url: string | null
          staff_roles_present: Json | null
          state: string
          subdomain: string | null
          updated_at: string
        }
        Insert: {
          audio_retention_policy?: string
          auto_publish_on_approval?: boolean
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          id?: string
          meeting_formality?: Database["public"]["Enums"]["meeting_formality"]
          minutes_recorder_default?: string | null
          minutes_review_window_days?: number
          minutes_style?: Database["public"]["Enums"]["minutes_style"]
          minutes_workflow_configured_at?: string | null
          municipality_type?: Database["public"]["Enums"]["municipality_type"]
          name: string
          population_range?: string | null
          presiding_officer_default?: string | null
          retention_policy_acknowledged_at?: string | null
          seal_url?: string | null
          staff_roles_present?: Json | null
          state?: string
          subdomain?: string | null
          updated_at?: string
        }
        Update: {
          audio_retention_policy?: string
          auto_publish_on_approval?: boolean
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string
          id?: string
          meeting_formality?: Database["public"]["Enums"]["meeting_formality"]
          minutes_recorder_default?: string | null
          minutes_review_window_days?: number
          minutes_style?: Database["public"]["Enums"]["minutes_style"]
          minutes_workflow_configured_at?: string | null
          municipality_type?: Database["public"]["Enums"]["municipality_type"]
          name?: string
          population_range?: string | null
          presiding_officer_default?: string | null
          retention_policy_acknowledged_at?: string | null
          seal_url?: string | null
          staff_roles_present?: Json | null
          state?: string
          subdomain?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      town_notification_config: {
        Row: {
          created_at: string
          id: string
          postmark_sender_email: string | null
          postmark_sender_name: string | null
          postmark_server_token_encrypted: string | null
          sms_opt_in_message: string | null
          sms_quiet_hours_end: string | null
          sms_quiet_hours_start: string | null
          town_id: string
          twilio_messaging_service_sid: string | null
          twilio_phone_number: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          postmark_sender_email?: string | null
          postmark_sender_name?: string | null
          postmark_server_token_encrypted?: string | null
          sms_opt_in_message?: string | null
          sms_quiet_hours_end?: string | null
          sms_quiet_hours_start?: string | null
          town_id: string
          twilio_messaging_service_sid?: string | null
          twilio_phone_number?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          postmark_sender_email?: string | null
          postmark_sender_name?: string | null
          postmark_server_token_encrypted?: string | null
          sms_opt_in_message?: string | null
          sms_quiet_hours_end?: string | null
          sms_quiet_hours_start?: string | null
          town_id?: string
          twilio_messaging_service_sid?: string | null
          twilio_phone_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "town_notification_config_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: true
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      user_account: {
        Row: {
          archived_at: string | null
          auth_user_id: string | null
          created_at: string
          display_name: string | null
          email: string | null
          email_bounced: boolean
          email_bounced_at: string | null
          email_complained: boolean
          email_complained_at: string | null
          gov_title: string | null
          id: string
          permissions: Json
          person_id: string
          role: Database["public"]["Enums"]["user_role"]
          town_id: string
        }
        Insert: {
          archived_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_bounced?: boolean
          email_bounced_at?: string | null
          email_complained?: boolean
          email_complained_at?: string | null
          gov_title?: string | null
          id?: string
          permissions?: Json
          person_id: string
          role: Database["public"]["Enums"]["user_role"]
          town_id: string
        }
        Update: {
          archived_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_bounced?: boolean
          email_bounced_at?: string | null
          email_complained?: boolean
          email_complained_at?: string | null
          gov_title?: string | null
          id?: string
          permissions?: Json
          person_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          town_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_account_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_account_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
      vote_record: {
        Row: {
          board_member_id: string
          created_at: string
          id: string
          meeting_id: string
          motion_id: string
          recusal_reason: string | null
          town_id: string
          vote: Database["public"]["Enums"]["vote_type"]
        }
        Insert: {
          board_member_id: string
          created_at?: string
          id?: string
          meeting_id: string
          motion_id: string
          recusal_reason?: string | null
          town_id: string
          vote: Database["public"]["Enums"]["vote_type"]
        }
        Update: {
          board_member_id?: string
          created_at?: string
          id?: string
          meeting_id?: string
          motion_id?: string
          recusal_reason?: string | null
          town_id?: string
          vote?: Database["public"]["Enums"]["vote_type"]
        }
        Relationships: [
          {
            foreignKeyName: "vote_record_board_member_id_fkey"
            columns: ["board_member_id"]
            isOneToOne: false
            referencedRelation: "board_member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_record_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_record_motion_id_fkey"
            columns: ["motion_id"]
            isOneToOne: false
            referencedRelation: "motion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_record_town_id_fkey"
            columns: ["town_id"]
            isOneToOne: false
            referencedRelation: "town"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      pg_stat_statements: {
        Row: {
          blk_read_time: number | null
          blk_write_time: number | null
          calls: number | null
          dbid: unknown
          jit_emission_count: number | null
          jit_emission_time: number | null
          jit_functions: number | null
          jit_generation_time: number | null
          jit_inlining_count: number | null
          jit_inlining_time: number | null
          jit_optimization_count: number | null
          jit_optimization_time: number | null
          local_blks_dirtied: number | null
          local_blks_hit: number | null
          local_blks_read: number | null
          local_blks_written: number | null
          max_exec_time: number | null
          max_plan_time: number | null
          mean_exec_time: number | null
          mean_plan_time: number | null
          min_exec_time: number | null
          min_plan_time: number | null
          plans: number | null
          query: string | null
          queryid: number | null
          rows: number | null
          shared_blks_dirtied: number | null
          shared_blks_hit: number | null
          shared_blks_read: number | null
          shared_blks_written: number | null
          stddev_exec_time: number | null
          stddev_plan_time: number | null
          temp_blk_read_time: number | null
          temp_blk_write_time: number | null
          temp_blks_read: number | null
          temp_blks_written: number | null
          toplevel: boolean | null
          total_exec_time: number | null
          total_plan_time: number | null
          userid: unknown
          wal_bytes: number | null
          wal_fpi: number | null
          wal_records: number | null
        }
        Relationships: []
      }
      pg_stat_statements_info: {
        Row: {
          dealloc: number | null
          stats_reset: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      complete_onboarding: {
        Args: {
          p_additional_boards?: Json
          p_board_name?: string
          p_contact_email?: string
          p_contact_name?: string
          p_district_based?: boolean
          p_election_method?: string
          p_meeting_formality?: string
          p_member_count?: number
          p_minutes_recorder?: string
          p_minutes_style?: string
          p_municipality_type?: string
          p_officer_election_method?: string
          p_population_range?: string
          p_presiding_officer?: string
          p_seat_titles?: Json
          p_staff_roles_present?: Json
          p_staggered_terms?: boolean
          p_state?: string
          p_town_name: string
        }
        Returns: string
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_current_person_id: { Args: never; Returns: string }
      get_current_role: { Args: never; Returns: string }
      get_current_town_id: { Args: never; Returns: string }
      get_current_user_account_id: { Args: never; Returns: string }
      gettransactionid: { Args: never; Returns: unknown }
      has_board_permission: {
        Args: { action_code: string; target_board_id: string }
        Returns: boolean
      }
      has_permission: { Args: { action_code: string }; Returns: boolean }
      invite_user: {
        Args: {
          p_email: string
          p_person_id: string
          p_redirect_url?: string
          p_role: string
          p_town_id: string
          p_user_account_id: string
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      longtransactionsenabled: { Args: never; Returns: boolean }
      pg_stat_statements: {
        Args: { showtext: boolean }
        Returns: Record<string, unknown>[]
      }
      pg_stat_statements_info: { Args: never; Returns: Record<string, unknown> }
      pg_stat_statements_reset: {
        Args: { dbid?: unknown; queryid?: number; userid?: unknown }
        Returns: undefined
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      agenda_item_status:
        | "pending"
        | "active"
        | "completed"
        | "tabled"
        | "deferred"
      attendance_status:
        | "present"
        | "absent"
        | "remote"
        | "excused"
        | "late_arrival"
        | "early_departure"
      board_member_status: "active" | "archived"
      board_type:
        | "select_board"
        | "planning_board"
        | "zoning_board"
        | "budget_committee"
        | "conservation_commission"
        | "parks_recreation"
        | "harbor_committee"
        | "shellfish_commission"
        | "cemetery_committee"
        | "road_committee"
        | "comp_plan_committee"
        | "broadband_committee"
        | "other"
      exhibit_visibility: "public" | "board_only" | "admin_only"
      meeting_formality: "informal" | "semi_formal" | "formal"
      meeting_status:
        | "draft"
        | "noticed"
        | "open"
        | "adjourned"
        | "minutes_draft"
        | "approved"
        | "cancelled"
      minutes_document_status: "draft" | "review" | "approved" | "published"
      minutes_generated_by: "manual" | "ai" | "hybrid"
      minutes_style: "action" | "summary" | "narrative"
      motion_status:
        | "pending"
        | "seconded"
        | "in_vote"
        | "passed"
        | "failed"
        | "tabled"
        | "withdrawn"
      motion_type:
        | "main"
        | "amendment"
        | "substitute"
        | "table"
        | "untable"
        | "postpone"
        | "reconsider"
        | "adjourn"
      municipality_type: "town" | "city" | "plantation"
      notification_channel: "email" | "sms"
      notification_delivery_status:
        | "pending"
        | "sent"
        | "delivered"
        | "bounced"
        | "failed"
        | "complained"
      notification_event_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
      notification_event_type:
        | "meeting_scheduled"
        | "meeting_cancelled"
        | "agenda_published"
        | "minutes_review"
        | "minutes_approved"
        | "minutes_published"
        | "admin_alert"
        | "user_invited"
        | "password_reset"
        | "straw_poll_created"
      notification_status:
        | "pending"
        | "processing"
        | "sent"
        | "delivered"
        | "failed"
        | "bounced"
      user_role: "sys_admin" | "admin" | "staff" | "board_member"
      vote_type: "yes" | "no" | "abstain" | "recusal" | "absent"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agenda_item_status: [
        "pending",
        "active",
        "completed",
        "tabled",
        "deferred",
      ],
      attendance_status: [
        "present",
        "absent",
        "remote",
        "excused",
        "late_arrival",
        "early_departure",
      ],
      board_member_status: ["active", "archived"],
      board_type: [
        "select_board",
        "planning_board",
        "zoning_board",
        "budget_committee",
        "conservation_commission",
        "parks_recreation",
        "harbor_committee",
        "shellfish_commission",
        "cemetery_committee",
        "road_committee",
        "comp_plan_committee",
        "broadband_committee",
        "other",
      ],
      exhibit_visibility: ["public", "board_only", "admin_only"],
      meeting_formality: ["informal", "semi_formal", "formal"],
      meeting_status: [
        "draft",
        "noticed",
        "open",
        "adjourned",
        "minutes_draft",
        "approved",
        "cancelled",
      ],
      minutes_document_status: ["draft", "review", "approved", "published"],
      minutes_generated_by: ["manual", "ai", "hybrid"],
      minutes_style: ["action", "summary", "narrative"],
      motion_status: [
        "pending",
        "seconded",
        "in_vote",
        "passed",
        "failed",
        "tabled",
        "withdrawn",
      ],
      motion_type: [
        "main",
        "amendment",
        "substitute",
        "table",
        "untable",
        "postpone",
        "reconsider",
        "adjourn",
      ],
      municipality_type: ["town", "city", "plantation"],
      notification_channel: ["email", "sms"],
      notification_delivery_status: [
        "pending",
        "sent",
        "delivered",
        "bounced",
        "failed",
        "complained",
      ],
      notification_event_status: [
        "pending",
        "processing",
        "completed",
        "failed",
      ],
      notification_event_type: [
        "meeting_scheduled",
        "meeting_cancelled",
        "agenda_published",
        "minutes_review",
        "minutes_approved",
        "minutes_published",
        "admin_alert",
        "user_invited",
        "password_reset",
        "straw_poll_created",
      ],
      notification_status: [
        "pending",
        "processing",
        "sent",
        "delivered",
        "failed",
        "bounced",
      ],
      user_role: ["sys_admin", "admin", "staff", "board_member"],
      vote_type: ["yes", "no", "abstain", "recusal", "absent"],
    },
  },
} as const

