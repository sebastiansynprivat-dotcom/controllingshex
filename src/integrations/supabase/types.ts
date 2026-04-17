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
      chatter_history: {
        Row: {
          account: string | null
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
          account?: string | null
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
          account?: string | null
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
      models: {
        Row: {
          created_at: string
          email: string | null
          follower_count: number
          id: string
          model_name: string
          password: string | null
          platform: string
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
          updated_at?: string
          user_id?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
