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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_user: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          full_name?: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_user_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_item: {
        Row: {
          active: boolean
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          default_markup_bp: number
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["catalog_item_kind"]
          name: string
          notes: string | null
          taxable: boolean
          unit: Database["public"]["Enums"]["catalog_item_unit"]
          unit_cost_cents: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          default_markup_bp?: number
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["catalog_item_kind"]
          name: string
          notes?: string | null
          taxable?: boolean
          unit?: Database["public"]["Enums"]["catalog_item_unit"]
          unit_cost_cents?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          default_markup_bp?: number
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["catalog_item_kind"]
          name?: string
          notes?: string | null
          taxable?: boolean
          unit?: Database["public"]["Enums"]["catalog_item_unit"]
          unit_cost_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_item_price_history: {
        Row: {
          catalog_item_id: string
          changed_at: string
          changed_by: string | null
          company_id: string
          id: string
          new_price_cents: number
          old_price_cents: number
        }
        Insert: {
          catalog_item_id: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          id?: string
          new_price_cents: number
          old_price_cents: number
        }
        Update: {
          catalog_item_id?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          id?: string
          new_price_cents?: number
          old_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_price_history_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_price_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      client: {
        Row: {
          billing_address: string | null
          company_id: string
          company_name: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          emails: string[]
          id: string
          name: string
          notes: string | null
          phones: string[]
          referral_source: string | null
          updated_at: string
        }
        Insert: {
          billing_address?: string | null
          company_id: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          emails?: string[]
          id?: string
          name: string
          notes?: string | null
          phones?: string[]
          referral_source?: string | null
          updated_at?: string
        }
        Update: {
          billing_address?: string | null
          company_id?: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          emails?: string[]
          id?: string
          name?: string
          notes?: string | null
          phones?: string[]
          referral_source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      company: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string
          currency: string
          dba: string | null
          default_tax_bp: number
          deleted_at: string | null
          deleted_by: string | null
          deposit_fixed_cents: number | null
          deposit_pct: number | null
          email: string | null
          id: string
          insurance_carrier: string | null
          insurance_expires_at: string | null
          insurance_policy: string | null
          legal_name: string | null
          license_expires_at: string | null
          license_number: string | null
          logo_path: string | null
          name: string
          payment_terms_days: number
          phone: string | null
          state: string | null
          tax_id: string | null
          updated_at: string
          website: string | null
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          dba?: string | null
          default_tax_bp?: number
          deleted_at?: string | null
          deleted_by?: string | null
          deposit_fixed_cents?: number | null
          deposit_pct?: number | null
          email?: string | null
          id?: string
          insurance_carrier?: string | null
          insurance_expires_at?: string | null
          insurance_policy?: string | null
          legal_name?: string | null
          license_expires_at?: string | null
          license_number?: string | null
          logo_path?: string | null
          name: string
          payment_terms_days?: number
          phone?: string | null
          state?: string | null
          tax_id?: string | null
          updated_at?: string
          website?: string | null
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          dba?: string | null
          default_tax_bp?: number
          deleted_at?: string | null
          deleted_by?: string | null
          deposit_fixed_cents?: number | null
          deposit_pct?: number | null
          email?: string | null
          id?: string
          insurance_carrier?: string | null
          insurance_expires_at?: string | null
          insurance_policy?: string | null
          legal_name?: string | null
          license_expires_at?: string | null
          license_number?: string | null
          logo_path?: string | null
          name?: string
          payment_terms_days?: number
          phone?: string | null
          state?: string | null
          tax_id?: string | null
          updated_at?: string
          website?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      invite_token: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          token: string
          used_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          token?: string
          used_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_token_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      project: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          property_id: string
          scope_summary: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          property_id: string
          scope_summary?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          property_id?: string
          scope_summary?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property"
            referencedColumns: ["id"]
          },
        ]
      }
      project_user: {
        Row: {
          assigned_at: string
          company_id: string
          project_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          company_id: string
          project_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          company_id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_user_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_user_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_user_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      property: {
        Row: {
          access_notes: string | null
          address_line1: string
          address_line2: string | null
          city: string | null
          client_id: string
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          notes: string | null
          state: string | null
          unit_lot: string | null
          updated_at: string
          year_built: number | null
          zip: string | null
        }
        Insert: {
          access_notes?: string | null
          address_line1: string
          address_line2?: string | null
          city?: string | null
          client_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          notes?: string | null
          state?: string | null
          unit_lot?: string | null
          updated_at?: string
          year_built?: number | null
          zip?: string | null
        }
        Update: {
          access_notes?: string | null
          address_line1?: string
          address_line2?: string | null
          city?: string | null
          client_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          notes?: string | null
          state?: string | null
          unit_lot?: string | null
          updated_at?: string
          year_built?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_company_id: { Args: never; Returns: string }
      auth_user_role: { Args: never; Returns: string }
    }
    Enums: {
      catalog_item_kind:
        | "labor"
        | "material"
        | "equipment"
        | "subcontract"
        | "other"
      catalog_item_unit:
        | "ea"
        | "sq_ft"
        | "lin_ft"
        | "sq"
        | "hour"
        | "day"
        | "load"
      project_status:
        | "lead"
        | "estimating"
        | "approved"
        | "scheduled"
        | "in_progress"
        | "complete"
        | "closed"
        | "lost"
      user_role: "owner" | "admin" | "crew"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      catalog_item_kind: [
        "labor",
        "material",
        "equipment",
        "subcontract",
        "other",
      ],
      catalog_item_unit: ["ea", "sq_ft", "lin_ft", "sq", "hour", "day", "load"],
      project_status: [
        "lead",
        "estimating",
        "approved",
        "scheduled",
        "in_progress",
        "complete",
        "closed",
        "lost",
      ],
      user_role: ["owner", "admin", "crew"],
    },
  },
} as const
