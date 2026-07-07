export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      action_outcomes: {
        Row: {
          action_key: string | null
          action_kind: string | null
          action_type: string
          baseline_revenue_7d: number
          chatter_name: string
          created_at: string
          delta_24h: number | null
          delta_48h: number | null
          delta_72h: number | null
          done_at: string
          estimated_eur: number
          feedback_at: string | null
          helped: boolean | null
          id: string
          platform: string
          revenue_after_24h: number | null
          revenue_after_48h: number | null
          revenue_after_72h: number | null
          revenue_before_24h: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_key?: string | null
          action_kind?: string | null
          action_type: string
          baseline_revenue_7d?: number
          chatter_name: string
          created_at?: string
          delta_24h?: number | null
          delta_48h?: number | null
          delta_72h?: number | null
          done_at?: string
          estimated_eur?: number
          feedback_at?: string | null
          helped?: boolean | null
          id?: string
          platform?: string
          revenue_after_24h?: number | null
          revenue_after_48h?: number | null
          revenue_after_72h?: number | null
          revenue_before_24h?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_key?: string | null
          action_kind?: string | null
          action_type?: string
          baseline_revenue_7d?: number
          chatter_name?: string
          created_at?: string
          delta_24h?: number | null
          delta_48h?: number | null
          delta_72h?: number | null
          done_at?: string
          estimated_eur?: number
          feedback_at?: string | null
          helped?: boolean | null
          id?: string
          platform?: string
          revenue_after_24h?: number | null
          revenue_after_48h?: number | null
          revenue_after_72h?: number | null
          revenue_before_24h?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      alert_dismissals: {
        Row: {
          alert_type: string
          chatter_name: string
          dismissed_at: string
          id: string
          platform: string
          report_id: string
          user_id: string
        }
        Insert: {
          alert_type: string
          chatter_name: string
          dismissed_at?: string
          id?: string
          platform?: string
          report_id: string
          user_id: string
        }
        Update: {
          alert_type?: string
          chatter_name?: string
          dismissed_at?: string
          id?: string
          platform?: string
          report_id?: string
          user_id?: string
        }
        Relationships: []
      }
      analysis_reports: {
        Row: {
          analysis_date: string
          chatter_count: number
          created_at: string
          file_name: string
          file_path: string
          id: string
          platform: string
          result_json: Json | null
          user_id: string | null
        }
        Insert: {
          analysis_date?: string
          chatter_count?: number
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          platform?: string
          result_json?: Json | null
          user_id?: string | null
        }
        Update: {
          analysis_date?: string
          chatter_count?: number
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          platform?: string
          result_json?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      anomaly_alerts: {
        Row: {
          alert_type: string
          baseline_value: number | null
          chatter_name: string
          created_at: string
          delta_pct: number | null
          detection_date: string
          id: string
          message: string
          metric_value: number | null
          platform: string
          resolved_at: string | null
          severity: string
          snoozed_until: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_type: string
          baseline_value?: number | null
          chatter_name: string
          created_at?: string
          delta_pct?: number | null
          detection_date?: string
          id?: string
          message: string
          metric_value?: number | null
          platform?: string
          resolved_at?: string | null
          severity?: string
          snoozed_until?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_type?: string
          baseline_value?: number | null
          chatter_name?: string
          created_at?: string
          delta_pct?: number | null
          detection_date?: string
          id?: string
          message?: string
          metric_value?: number | null
          platform?: string
          resolved_at?: string | null
          severity?: string
          snoozed_until?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      channel_knowledge: {
        Row: {
          body: string
          created_at: string
          id: string
          platform: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          platform?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          platform?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      channel_plan_days: {
        Row: {
          context_notes: Json
          id: string
          plan_date: string
          plan_id: string
          position: number
          post_text: string
          theme: string
          updated_at: string
          user_id: string
          weekday: number
        }
        Insert: {
          context_notes?: Json
          id?: string
          plan_date: string
          plan_id: string
          position?: number
          post_text?: string
          theme?: string
          updated_at?: string
          user_id: string
          weekday: number
        }
        Update: {
          context_notes?: Json
          id?: string
          plan_date?: string
          plan_id?: string
          position?: number
          post_text?: string
          theme?: string
          updated_at?: string
          user_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_plan_days_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "channel_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_plans: {
        Row: {
          created_at: string
          generation_context: string | null
          id: string
          platform: string
          user_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          generation_context?: string | null
          id?: string
          platform?: string
          user_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          generation_context?: string | null
          id?: string
          platform?: string
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      chatter_activity_sessions: {
        Row: {
          chatter_name: string
          created_at: string
          date: string
          duration_min: number
          ended_at: string
          first_response_min: number | null
          id: string
          incoming_proxy: number
          mass_dms_in_session: number
          platform: string
          revenue_in_session: number
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          date: string
          duration_min?: number
          ended_at: string
          first_response_min?: number | null
          id?: string
          incoming_proxy?: number
          mass_dms_in_session?: number
          platform?: string
          revenue_in_session?: number
          started_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          date?: string
          duration_min?: number
          ended_at?: string
          first_response_min?: number | null
          id?: string
          incoming_proxy?: number
          mass_dms_in_session?: number
          platform?: string
          revenue_in_session?: number
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chatter_category_state: {
        Row: {
          chatter_name: string
          created_at: string
          current_category: string
          id: string
          last_evaluation_date: string
          last_signals: Json | null
          platform: string
          since_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          current_category: string
          id?: string
          last_evaluation_date?: string
          last_signals?: Json | null
          platform?: string
          since_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          current_category?: string
          id?: string
          last_evaluation_date?: string
          last_signals?: Json | null
          platform?: string
          since_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chatter_daily_goals: {
        Row: {
          chatter_name: string
          created_at: string
          goal_date: string
          goal_eur: number
          id: string
          note: string | null
          platform: string
          source: string
          suggested_eur: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          goal_date?: string
          goal_eur: number
          id?: string
          note?: string | null
          platform?: string
          source?: string
          suggested_eur?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          goal_date?: string
          goal_eur?: number
          id?: string
          note?: string | null
          platform?: string
          source?: string
          suggested_eur?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chatter_history: {
        Row: {
          account: string
          analysis_date: string
          category: string | null
          chatter_name: string
          created_at: string
          id: string
          mass_dms: number | null
          open_chats: number | null
          platform: string
          recommendation: string | null
          response_delay_days: number | null
          revenue_today: number | null
          user_id: string | null
        }
        Insert: {
          account?: string
          analysis_date?: string
          category?: string | null
          chatter_name: string
          created_at?: string
          id?: string
          mass_dms?: number | null
          open_chats?: number | null
          platform?: string
          recommendation?: string | null
          response_delay_days?: number | null
          revenue_today?: number | null
          user_id?: string | null
        }
        Update: {
          account?: string
          analysis_date?: string
          category?: string | null
          chatter_name?: string
          created_at?: string
          id?: string
          mass_dms?: number | null
          open_chats?: number | null
          platform?: string
          recommendation?: string | null
          response_delay_days?: number | null
          revenue_today?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      chatter_history_live: {
        Row: {
          chatter_name: string
          date: string
          id: string
          mass_dms: number
          oldest_chat: number | null
          platform: string
          revenue: number
          telegram_id: string | null
          unread_chats: number
          updated_at: string
        }
        Insert: {
          chatter_name: string
          date?: string
          id?: string
          mass_dms?: number
          oldest_chat?: number | null
          platform?: string
          revenue?: number
          telegram_id?: string | null
          unread_chats?: number
          updated_at?: string
        }
        Update: {
          chatter_name?: string
          date?: string
          id?: string
          mass_dms?: number
          oldest_chat?: number | null
          platform?: string
          revenue?: number
          telegram_id?: string | null
          unread_chats?: number
          updated_at?: string
        }
        Relationships: []
      }
      chatter_hourly_stats: {
        Row: {
          chatter_name: string
          created_at: string
          date: string
          hour: number
          id: string
          mass_dms: number
          platform: string
          revenue: number
          unread_delta: number
          updated_at: string
          updates_seen: number
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          date?: string
          hour: number
          id?: string
          mass_dms?: number
          platform?: string
          revenue?: number
          unread_delta?: number
          updated_at?: string
          updates_seen?: number
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          date?: string
          hour?: number
          id?: string
          mass_dms?: number
          platform?: string
          revenue?: number
          unread_delta?: number
          updated_at?: string
          updates_seen?: number
          user_id?: string
        }
        Relationships: []
      }
      chatter_inputs: {
        Row: {
          chatter_name: string
          created_at: string
          id: string
          input_type: string
          note: string | null
          platform: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          id?: string
          input_type: string
          note?: string | null
          platform?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          id?: string
          input_type?: string
          note?: string | null
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      chatter_label_assignments: {
        Row: {
          chatter_name: string
          created_at: string
          id: string
          label_id: string
          platform: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          id?: string
          label_id: string
          platform?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          id?: string
          label_id?: string
          platform?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatter_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "chatter_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      chatter_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          label_name: string
          platform: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          label_name: string
          platform?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          label_name?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      chatter_memos: {
        Row: {
          chatter_name: string
          created_at: string
          follow_up_at: string | null
          id: string
          platform: string
          resolved_at: string | null
          status: string
          text: string
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          follow_up_at?: string | null
          id?: string
          platform?: string
          resolved_at?: string | null
          status?: string
          text: string
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          follow_up_at?: string | null
          id?: string
          platform?: string
          resolved_at?: string | null
          status?: string
          text?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coaching_notes: {
        Row: {
          chatter_name: string
          created_at: string
          id: string
          note_text: string
          platform: string
          user_id: string | null
        }
        Insert: {
          chatter_name: string
          created_at?: string
          id?: string
          note_text: string
          platform?: string
          user_id?: string | null
        }
        Update: {
          chatter_name?: string
          created_at?: string
          id?: string
          note_text?: string
          platform?: string
          user_id?: string | null
        }
        Relationships: []
      }
      daily_chatter_checks: {
        Row: {
          chatter_name: string
          check_date: string
          created_at: string
          id: string
          platform: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          check_date?: string
          created_at?: string
          id?: string
          platform?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          check_date?: string
          created_at?: string
          id?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_todo_state: {
        Row: {
          acted_at: string
          created_at: string
          id: string
          platform: string
          snoozed_until: string | null
          status: string
          todo_key: string
          user_id: string
        }
        Insert: {
          acted_at?: string
          created_at?: string
          id?: string
          platform?: string
          snoozed_until?: string | null
          status?: string
          todo_key: string
          user_id: string
        }
        Update: {
          acted_at?: string
          created_at?: string
          id?: string
          platform?: string
          snoozed_until?: string | null
          status?: string
          todo_key?: string
          user_id?: string
        }
        Relationships: []
      }
      goal_message_templates: {
        Row: {
          created_at: string
          id: string
          scenario: Database["public"]["Enums"]["goal_message_scenario"]
          template: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          scenario: Database["public"]["Enums"]["goal_message_scenario"]
          template: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          scenario?: Database["public"]["Enums"]["goal_message_scenario"]
          template?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hot_streak_alerts: {
        Row: {
          alert_date: string
          baseline_avg: number
          chatter_name: string
          expected_pace: number
          id: string
          pace_pct: number
          platform: string
          revenue_at_alert: number
          sent_at: string
          user_id: string
        }
        Insert: {
          alert_date?: string
          baseline_avg?: number
          chatter_name: string
          expected_pace?: number
          id?: string
          pace_pct?: number
          platform?: string
          revenue_at_alert?: number
          sent_at?: string
          user_id: string
        }
        Update: {
          alert_date?: string
          baseline_avg?: number
          chatter_name?: string
          expected_pace?: number
          id?: string
          pace_pct?: number
          platform?: string
          revenue_at_alert?: number
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      live_now_counts: {
        Row: {
          chatter_names: string[]
          computed_at: string
          count: number
          id: string
          platform: string
          user_id: string
        }
        Insert: {
          chatter_names?: string[]
          computed_at?: string
          count?: number
          id?: string
          platform?: string
          user_id: string
        }
        Update: {
          chatter_names?: string[]
          computed_at?: string
          count?: number
          id?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      model_attributes: {
        Row: {
          age_group: string | null
          ai_summary: string | null
          analyzed_at: string
          body_type: string | null
          created_at: string
          hair_color: string | null
          id: string
          model_id: string
          source_image_url: string | null
          specials: string[] | null
          style: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          age_group?: string | null
          ai_summary?: string | null
          analyzed_at?: string
          body_type?: string | null
          created_at?: string
          hair_color?: string | null
          id?: string
          model_id: string
          source_image_url?: string | null
          specials?: string[] | null
          style?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          age_group?: string | null
          ai_summary?: string | null
          analyzed_at?: string
          body_type?: string | null
          created_at?: string
          hair_color?: string | null
          id?: string
          model_id?: string
          source_image_url?: string | null
          specials?: string[] | null
          style?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_attributes_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: true
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      model_label_assignments: {
        Row: {
          created_at: string
          id: string
          label_id: string
          model_name: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_id: string
          model_name: string
          platform: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label_id?: string
          model_name?: string
          platform?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "model_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      model_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          label_name: string
          platform: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          label_name: string
          platform: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          label_name?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      model_notes: {
        Row: {
          created_at: string
          id: string
          model_name: string
          note_text: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          model_name: string
          note_text: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          model_name?: string
          note_text?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      models: {
        Row: {
          created_at: string
          email: string | null
          follower_count: number
          id: string
          model_name: string
          password: string | null
          platform: string
          profile_image_url: string | null
          profile_url: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          follower_count?: number
          id?: string
          model_name: string
          password?: string | null
          platform?: string
          profile_image_url?: string | null
          profile_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          follower_count?: number
          id?: string
          model_name?: string
          password?: string | null
          platform?: string
          profile_image_url?: string | null
          profile_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      monthly_goal_skips: {
        Row: {
          chatter_name: string
          created_at: string
          id: string
          platform: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          id?: string
          platform?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          id?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string | null
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id?: string | null
          value?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string | null
          value?: string
        }
        Relationships: []
      }
      snippet_sends: {
        Row: {
          chatter_name: string
          id: string
          platform: string
          sent_at: string
          snippet_id: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          id?: string
          platform?: string
          sent_at?: string
          snippet_id: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          id?: string
          platform?: string
          sent_at?: string
          snippet_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snippet_sends_snippet_id_fkey"
            columns: ["snippet_id"]
            isOneToOne: false
            referencedRelation: "text_snippets"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_notes: {
        Row: {
          body: string
          category: string | null
          created_at: string
          id: string
          media_urls: string[]
          platform: string
          position: number
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          category?: string | null
          created_at?: string
          id?: string
          media_urls?: string[]
          platform?: string
          position?: number
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          id?: string
          media_urls?: string[]
          platform?: string
          position?: number
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      swap_decisions: {
        Row: {
          chatter_a: string
          chatter_b: string
          created_at: string
          id: string
          model_a: string | null
          model_b: string | null
          platform: string
          snoozed_until: string | null
          status: string
          user_id: string
        }
        Insert: {
          chatter_a: string
          chatter_b: string
          created_at?: string
          id?: string
          model_a?: string | null
          model_b?: string | null
          platform?: string
          snoozed_until?: string | null
          status?: string
          user_id: string
        }
        Update: {
          chatter_a?: string
          chatter_b?: string
          created_at?: string
          id?: string
          model_a?: string | null
          model_b?: string | null
          platform?: string
          snoozed_until?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      talent_account_rejections: {
        Row: {
          account_norm: string
          id: string
          platform: string
          rejected_at: string
          riser_norm: string
          user_id: string
        }
        Insert: {
          account_norm: string
          id?: string
          platform?: string
          rejected_at?: string
          riser_norm: string
          user_id: string
        }
        Update: {
          account_norm?: string
          id?: string
          platform?: string
          rejected_at?: string
          riser_norm?: string
          user_id?: string
        }
        Relationships: []
      }
      text_snippets: {
        Row: {
          body: string
          created_at: string
          day_offset: number
          id: string
          media_urls: string[]
          platform: string
          position: number
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          day_offset?: number
          id?: string
          media_urls?: string[]
          platform?: string
          position?: number
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          day_offset?: number
          id?: string
          media_urls?: string[]
          platform?: string
          position?: number
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      todos: {
        Row: {
          created_at: string
          id: string
          is_done: boolean
          platform: string
          position: number
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_done?: boolean
          platform?: string
          position?: number
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_done?: boolean
          platform?: string
          position?: number
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_coachings: {
        Row: {
          chatter_name: string
          created_at: string
          id: string
          platform: string
          sent_at: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          id?: string
          platform?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          id?: string
          platform?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_goal_results: {
        Row: {
          achieved: boolean
          actual_eur: number
          chatter_name: string
          goal_eur: number
          id: string
          platform: string
          recorded_at: string
          source: string
          user_id: string
          week_end: string
          week_key: string
          week_start: string
        }
        Insert: {
          achieved: boolean
          actual_eur?: number
          chatter_name: string
          goal_eur: number
          id?: string
          platform: string
          recorded_at?: string
          source?: string
          user_id: string
          week_end: string
          week_key: string
          week_start: string
        }
        Update: {
          achieved?: boolean
          actual_eur?: number
          chatter_name?: string
          goal_eur?: number
          id?: string
          platform?: string
          recorded_at?: string
          source?: string
          user_id?: string
          week_end?: string
          week_key?: string
          week_start?: string
        }
        Relationships: []
      }
      weekly_goal_skips: {
        Row: {
          chatter_name: string
          created_at: string
          id: string
          platform: string
          user_id: string
        }
        Insert: {
          chatter_name: string
          created_at?: string
          id?: string
          platform?: string
          user_id: string
        }
        Update: {
          chatter_name?: string
          created_at?: string
          id?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_chatter_onboarding: {
        Args: { p_platform: string }
        Returns: {
          chatter_name: string
          onboarded_on: string
          report_day: number
        }[]
      }
      get_live_efficiency: {
        Args: {
          p_from: string
          p_platform: string
          p_to: string
          p_user_id: string
        }
        Returns: {
          active_days: number
          chatter_name: string
          eur_per_active_hour: number
          eur_per_incoming: number
          first_response_min_p50: number
          range_days: number
          session_consistency: number
          session_count: number
          total_active_min: number
          total_incoming_proxy: number
          total_mass_dms: number
          total_revenue: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      recompute_live_now: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      goal_message_scenario:
        | "growth"
        | "flat"
        | "decline"
        | "weekly_growth"
        | "weekly_flat"
        | "weekly_decline"
        | "weekly_intro"
    }
    CompositeTypes: {
      [_ in never]: never
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
      app_role: ["admin", "moderator", "user"],
      goal_message_scenario: [
        "growth",
        "flat",
        "decline",
        "weekly_growth",
        "weekly_flat",
        "weekly_decline",
        "weekly_intro",
      ],
    },
  },
} as const
