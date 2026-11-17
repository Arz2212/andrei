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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assistant_agreements: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          rule_text: string
          scope: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          is_active?: boolean
          rule_text: string
          scope?: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          is_active?: boolean
          rule_text?: string
          scope?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_messages: {
        Row: {
          content: string
          created_at: string
          id: number
          intent_kind: string | null
          metadata: Json
          modality: string
          role: string
          thread_id: number
          user_id: string
          voice_transcript: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: never
          intent_kind?: string | null
          metadata?: Json
          modality?: string
          role: string
          thread_id: number
          user_id: string
          voice_transcript?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: never
          intent_kind?: string | null
          metadata?: Json
          modality?: string
          role?: string
          thread_id?: number
          user_id?: string
          voice_transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "assistant_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_settings: {
        Row: {
          evening_review_time: string
          model_id: string
          morning_digest_time: string
          persona_name: string
          proactive_reminders_enabled: boolean
          system_prompt: string
          tone_guidelines: string
          updated_at: string
          user_id: string
          weekly_review_day: number
        }
        Insert: {
          evening_review_time?: string
          model_id?: string
          morning_digest_time?: string
          persona_name?: string
          proactive_reminders_enabled?: boolean
          system_prompt: string
          tone_guidelines?: string
          updated_at?: string
          user_id: string
          weekly_review_day?: number
        }
        Update: {
          evening_review_time?: string
          model_id?: string
          morning_digest_time?: string
          persona_name?: string
          proactive_reminders_enabled?: boolean
          system_prompt?: string
          tone_guidelines?: string
          updated_at?: string
          user_id?: string
          weekly_review_day?: number
        }
        Relationships: []
      }
      assistant_threads: {
        Row: {
          id: number
          message_thread_id: number
          rolling_summary: string | null
          telegram_chat_id: number
          topic_domain: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: never
          message_thread_id?: number
          rolling_summary?: string | null
          telegram_chat_id: number
          topic_domain?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: never
          message_thread_id?: number
          rolling_summary?: string | null
          telegram_chat_id?: number
          topic_domain?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calorie_logs: {
        Row: {
          barcode: string | null
          carbs_g: number | null
          created_at: string
          fat_g: number | null
          grams: number | null
          id: number
          kcal: number
          logged_date: string
          meal_slot: string
          protein_g: number | null
          title: string
          user_id: string
        }
        Insert: {
          barcode?: string | null
          carbs_g?: number | null
          created_at?: string
          fat_g?: number | null
          grams?: number | null
          id?: never
          kcal: number
          logged_date?: string
          meal_slot?: string
          protein_g?: number | null
          title: string
          user_id: string
        }
        Update: {
          barcode?: string | null
          carbs_g?: number | null
          created_at?: string
          fat_g?: number | null
          grams?: number | null
          id?: never
          kcal?: number
          logged_date?: string
          meal_slot?: string
          protein_g?: number | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_reviews: {
        Row: {
          assistant_summary: string | null
          created_at: string
          custom_scores: Json
          day_highlight: string | null
          habits_score: number | null
          health_score: number | null
          id: number
          nutrition_score: number | null
          review_date: string
          tasks_score: number | null
          tomorrow_main_thing: string | null
          updated_at: string
          user_id: string
          what_drained_energy: string | null
        }
        Insert: {
          assistant_summary?: string | null
          created_at?: string
          custom_scores?: Json
          day_highlight?: string | null
          habits_score?: number | null
          health_score?: number | null
          id?: never
          nutrition_score?: number | null
          review_date: string
          tasks_score?: number | null
          tomorrow_main_thing?: string | null
          updated_at?: string
          user_id: string
          what_drained_energy?: string | null
        }
        Update: {
          assistant_summary?: string | null
          created_at?: string
          custom_scores?: Json
          day_highlight?: string | null
          habits_score?: number | null
          health_score?: number | null
          id?: never
          nutrition_score?: number | null
          review_date?: string
          tasks_score?: number | null
          tomorrow_main_thing?: string | null
          updated_at?: string
          user_id?: string
          what_drained_energy?: string | null
        }
        Relationships: []
      }
      dashboard_widgets: {
        Row: {
          desktop_col_span: number
          desktop_order: number
          id: number
          is_visible: boolean
          mobile_order: number
          settings: Json
          title_override: string | null
          updated_at: string
          user_id: string
          widget_key: string
        }
        Insert: {
          desktop_col_span?: number
          desktop_order?: number
          id?: never
          is_visible?: boolean
          mobile_order?: number
          settings?: Json
          title_override?: string | null
          updated_at?: string
          user_id: string
          widget_key: string
        }
        Update: {
          desktop_col_span?: number
          desktop_order?: number
          id?: never
          is_visible?: boolean
          mobile_order?: number
          settings?: Json
          title_override?: string | null
          updated_at?: string
          user_id?: string
          widget_key?: string
        }
        Relationships: []
      }
      day_plans: {
        Row: {
          available_minutes: number
          buffer_minutes: number
          energy_mode: string
          id: number
          main_focus: string | null
          notes: string | null
          plan_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          available_minutes?: number
          buffer_minutes?: number
          energy_mode?: string
          id?: never
          main_focus?: string | null
          notes?: string | null
          plan_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          available_minutes?: number
          buffer_minutes?: number
          energy_mode?: string
          id?: never
          main_focus?: string | null
          notes?: string | null
          plan_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      evening_review_criteria: {
        Row: {
          criterion_slug: string
          domain_key: string
          id: number
          is_active: boolean
          label: string
          max_score: number
          scoring_rule_hint: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          criterion_slug: string
          domain_key: string
          id?: never
          is_active?: boolean
          label: string
          max_score?: number
          scoring_rule_hint: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          criterion_slug?: string
          domain_key?: string
          id?: never
          is_active?: boolean
          label?: string
          max_score?: number
          scoring_rule_hint?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_accounts: {
        Row: {
          account_type: string
          balance: number
          created_at: string
          credit_limit: number | null
          currency: string
          grace_period_due_date: string | null
          id: number
          include_in_safe_to_spend: boolean
          include_in_total: boolean
          is_archived: boolean
          name: string
          protected_reserve: number
          sort_order: number
          statement_debt: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type: string
          balance?: number
          created_at?: string
          credit_limit?: number | null
          currency?: string
          grace_period_due_date?: string | null
          id?: never
          include_in_safe_to_spend?: boolean
          include_in_total?: boolean
          is_archived?: boolean
          name: string
          protected_reserve?: number
          sort_order?: number
          statement_debt?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          balance?: number
          created_at?: string
          credit_limit?: number | null
          currency?: string
          grace_period_due_date?: string | null
          id?: never
          include_in_safe_to_spend?: boolean
          include_in_total?: boolean
          is_archived?: boolean
          name?: string
          protected_reserve?: number
          sort_order?: number
          statement_debt?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_categories: {
        Row: {
          color_token: string
          created_at: string
          icon_name: string
          id: number
          is_archived: boolean
          kind: string
          monthly_limit: number | null
          name: string
          sort_order: number
          user_id: string
          voice_aliases: string[]
        }
        Insert: {
          color_token?: string
          created_at?: string
          icon_name?: string
          id?: never
          is_archived?: boolean
          kind: string
          monthly_limit?: number | null
          name: string
          sort_order?: number
          user_id: string
          voice_aliases?: string[]
        }
        Update: {
          color_token?: string
          created_at?: string
          icon_name?: string
          id?: never
          is_archived?: boolean
          kind?: string
          monthly_limit?: number | null
          name?: string
          sort_order?: number
          user_id?: string
          voice_aliases?: string[]
        }
        Relationships: []
      }
      finance_debts: {
        Row: {
          counterparty: string
          created_at: string
          currency: string
          direction: string
          due_date: string | null
          id: number
          initial_amount: number
          notes: string | null
          remaining_amount: number
          reserve_in_safe_to_spend: boolean
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          counterparty: string
          created_at?: string
          currency?: string
          direction: string
          due_date?: string | null
          id?: never
          initial_amount: number
          notes?: string | null
          remaining_amount: number
          reserve_in_safe_to_spend?: boolean
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          counterparty?: string
          created_at?: string
          currency?: string
          direction?: string
          due_date?: string | null
          id?: never
          initial_amount?: number
          notes?: string | null
          remaining_amount?: number
          reserve_in_safe_to_spend?: boolean
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_obligations: {
        Row: {
          account_id: number | null
          amount: number
          billing_period: string
          category_id: number | null
          created_at: string
          currency: string
          deduct_from_safe_to_spend: boolean
          id: number
          is_active: boolean
          next_due_date: string
          obligation_kind: string
          remind_days_before: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: number | null
          amount: number
          billing_period?: string
          category_id?: number | null
          created_at?: string
          currency?: string
          deduct_from_safe_to_spend?: boolean
          id?: never
          is_active?: boolean
          next_due_date: string
          obligation_kind: string
          remind_days_before?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: number | null
          amount?: number
          billing_period?: string
          category_id?: number | null
          created_at?: string
          currency?: string
          deduct_from_safe_to_spend?: boolean
          id?: never
          is_active?: boolean
          next_due_date?: string
          obligation_kind?: string
          remind_days_before?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_obligations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_obligations_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_transactions: {
        Row: {
          account_id: number
          amount: number
          category_id: number | null
          created_at: string
          currency: string
          description: string | null
          id: number
          is_edited: boolean
          kind: string
          linked_expense_id: number | null
          occurred_at: string
          original_reimbursable_amount: number
          personal_share_amount: number | null
          raw_voice_phrase: string | null
          receipt_storage_path: string | null
          reimbursable_amount: number
          reimbursement_counterparty: string | null
          reimbursement_status: string
          source: string
          spend_nature: string
          tags: string[]
          to_account_id: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: number
          amount: number
          category_id?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: never
          is_edited?: boolean
          kind: string
          linked_expense_id?: number | null
          occurred_at?: string
          original_reimbursable_amount?: number
          personal_share_amount?: number | null
          raw_voice_phrase?: string | null
          receipt_storage_path?: string | null
          reimbursable_amount?: number
          reimbursement_counterparty?: string | null
          reimbursement_status?: string
          source?: string
          spend_nature?: string
          tags?: string[]
          to_account_id?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: number
          amount?: number
          category_id?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: never
          is_edited?: boolean
          kind?: string
          linked_expense_id?: number | null
          occurred_at?: string
          original_reimbursable_amount?: number
          personal_share_amount?: number | null
          raw_voice_phrase?: string | null
          receipt_storage_path?: string | null
          reimbursable_amount?: number
          reimbursement_counterparty?: string | null
          reimbursement_status?: string
          source?: string
          spend_nature?: string
          tags?: string[]
          to_account_id?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_linked_expense_id_fkey"
            columns: ["linked_expense_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          current_value: number
          id: number
          life_area: string
          motivation_note: string | null
          progress_mode: string
          start_date: string
          status: string
          target_date: string | null
          target_value: number | null
          title: string
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_value?: number
          id?: never
          life_area: string
          motivation_note?: string | null
          progress_mode?: string
          start_date?: string
          status?: string
          target_date?: string | null
          target_value?: number | null
          title: string
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_value?: number
          id?: never
          life_area?: string
          motivation_note?: string | null
          progress_mode?: string
          start_date?: string
          status?: string
          target_date?: string | null
          target_value?: number | null
          title?: string
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      habit_logs: {
        Row: {
          completed: boolean
          created_at: string
          habit_id: number
          id: number
          logged_date: string
          source: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          habit_id: number
          id?: never
          logged_date?: string
          source?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          habit_id?: number
          id?: never
          logged_date?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          cadence: string
          created_at: string
          goal_id: number | null
          icon_name: string
          id: number
          is_archived: boolean
          preferred_slot: string
          sort_order: number
          target_per_week: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cadence?: string
          created_at?: string
          goal_id?: number | null
          icon_name?: string
          id?: never
          is_archived?: boolean
          preferred_slot?: string
          sort_order?: number
          target_per_week?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cadence?: string
          created_at?: string
          goal_id?: number | null
          icon_name?: string
          id?: never
          is_archived?: boolean
          preferred_slot?: string
          sort_order?: number
          target_per_week?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habits_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_plan_entries: {
        Row: {
          created_at: string
          custom_meal_title: string | null
          id: number
          meal_slot: string
          plan_date: string
          planned_servings: number
          recipe_id: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_meal_title?: string | null
          id?: never
          meal_slot: string
          plan_date: string
          planned_servings?: number
          recipe_id?: number | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_meal_title?: string | null
          id?: never
          meal_slot?: string
          plan_date?: string
          planned_servings?: number
          recipe_id?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_plan_entries_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_doctors: {
        Row: {
          clinic_name: string | null
          contacts: string | null
          created_at: string
          full_name: string
          id: number
          notes: string | null
          specialty: string
          updated_at: string
          user_id: string
        }
        Insert: {
          clinic_name?: string | null
          contacts?: string | null
          created_at?: string
          full_name: string
          id?: never
          notes?: string | null
          specialty: string
          updated_at?: string
          user_id: string
        }
        Update: {
          clinic_name?: string | null
          contacts?: string | null
          created_at?: string
          full_name?: string
          id?: never
          notes?: string | null
          specialty?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      medical_documents: {
        Row: {
          created_at: string
          file_name: string
          id: number
          mime_type: string
          record_id: number
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: never
          mime_type: string
          record_id: number
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: never
          mime_type?: string
          record_id?: number
          size_bytes?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_documents_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_follow_ups: {
        Row: {
          action_title: string
          created_at: string
          due_date: string | null
          id: number
          is_done: boolean
          linked_task_id: number | null
          record_id: number
          user_id: string
        }
        Insert: {
          action_title: string
          created_at?: string
          due_date?: string | null
          id?: never
          is_done?: boolean
          linked_task_id?: number | null
          record_id: number
          user_id: string
        }
        Update: {
          action_title?: string
          created_at?: string
          due_date?: string | null
          id?: never
          is_done?: boolean
          linked_task_id?: number | null
          record_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_follow_ups_linked_task_id_fkey"
            columns: ["linked_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_follow_ups_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          created_at: string
          doctor_conclusion: string | null
          doctor_id: number | null
          id: number
          next_visit_date: string | null
          record_date: string
          record_kind: string
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          doctor_conclusion?: string | null
          doctor_id?: number | null
          id?: never
          next_visit_date?: string | null
          record_date: string
          record_kind: string
          summary?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          doctor_conclusion?: string | null
          doctor_id?: number | null
          id?: never
          next_visit_date?: string | null
          record_date?: string
          record_kind?: string
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "medical_doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      off_product_evaluations: {
        Row: {
          barcode: string
          brands: string | null
          carbs_100g: number | null
          fat_100g: number | null
          found_in_off: boolean
          has_complete_macros: boolean
          id: number
          kcal_100g: number | null
          product_name: string | null
          protein_100g: number | null
          query_note: string | null
          raw_off_response: Json | null
          tested_at: string
          user_id: string
        }
        Insert: {
          barcode: string
          brands?: string | null
          carbs_100g?: number | null
          fat_100g?: number | null
          found_in_off?: boolean
          has_complete_macros?: boolean
          id?: never
          kcal_100g?: number | null
          product_name?: string | null
          protein_100g?: number | null
          query_note?: string | null
          raw_off_response?: Json | null
          tested_at?: string
          user_id: string
        }
        Update: {
          barcode?: string
          brands?: string | null
          carbs_100g?: number | null
          fat_100g?: number | null
          found_in_off?: boolean
          has_complete_macros?: boolean
          id?: never
          kcal_100g?: number | null
          product_name?: string | null
          protein_100g?: number | null
          query_note?: string | null
          raw_off_response?: Json | null
          tested_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pantry_items: {
        Row: {
          display_name: string
          expires_on: string | null
          id: number
          ingredient_key: string
          low_stock_threshold: number | null
          quantity_on_hand: number
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          display_name: string
          expires_on?: string | null
          id?: never
          ingredient_key: string
          low_stock_threshold?: number | null
          quantity_on_hand?: number
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          display_name?: string
          expires_on?: string | null
          id?: never
          ingredient_key?: string
          low_stock_threshold?: number | null
          quantity_on_hand?: number
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_actions: {
        Row: {
          action_kind: string
          created_at: string
          expires_at: string
          id: number
          payload: Json
          preview_markdown: string
          resolved_at: string | null
          status: string
          telegram_chat_id: number | null
          telegram_message_id: number | null
          thread_id: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_kind: string
          created_at?: string
          expires_at?: string
          id?: never
          payload: Json
          preview_markdown: string
          resolved_at?: string | null
          status?: string
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          thread_id?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_kind?: string
          created_at?: string
          expires_at?: string
          id?: never
          payload?: Json
          preview_markdown?: string
          resolved_at?: string | null
          status?: string
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          thread_id?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "assistant_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          accent_token: string
          created_at: string
          description: string | null
          due_date: string | null
          goal_id: number | null
          id: number
          life_area: string
          sort_order: number
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accent_token?: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          goal_id?: number | null
          id?: never
          life_area: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accent_token?: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          goal_id?: number | null
          id?: never
          life_area?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          aisle_group: string
          amount: number
          display_name: string
          id: number
          ingredient_key: string
          is_optional: boolean
          recipe_id: number
          unit: string
          user_id: string
        }
        Insert: {
          aisle_group?: string
          amount: number
          display_name: string
          id?: never
          ingredient_key: string
          is_optional?: boolean
          recipe_id: number
          unit?: string
          user_id: string
        }
        Update: {
          aisle_group?: string
          amount?: number
          display_name?: string
          id?: never
          ingredient_key?: string
          is_optional?: boolean
          recipe_id?: number
          unit?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          carbs_g: number | null
          cook_time_minutes: number | null
          created_at: string
          default_servings: number
          fat_g: number | null
          id: number
          is_favorite: boolean
          kcal_per_serving: number | null
          meal_category: string
          photo_storage_path: string | null
          protein_g: number | null
          steps_markdown: string | null
          tags: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          carbs_g?: number | null
          cook_time_minutes?: number | null
          created_at?: string
          default_servings?: number
          fat_g?: number | null
          id?: never
          is_favorite?: boolean
          kcal_per_serving?: number | null
          meal_category?: string
          photo_storage_path?: string | null
          protein_g?: number | null
          steps_markdown?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          carbs_g?: number | null
          cook_time_minutes?: number | null
          created_at?: string
          default_servings?: number
          fat_g?: number | null
          id?: never
          is_favorite?: boolean
          kcal_per_serving?: number | null
          meal_category?: string
          photo_storage_path?: string | null
          protein_g?: number | null
          steps_markdown?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reminders_queue: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string
          error_text: string | null
          id: number
          message_text: string
          metadata: Json
          sent_at: string | null
          status: string
          telegram_chat_id: number
          trigger_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type: string
          error_text?: string | null
          id?: never
          message_text: string
          metadata?: Json
          sent_at?: string | null
          status?: string
          telegram_chat_id?: number
          trigger_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error_text?: string | null
          id?: never
          message_text?: string
          metadata?: Json
          sent_at?: string | null
          status?: string
          telegram_chat_id?: number
          trigger_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shopping_list_items: {
        Row: {
          added_from: string
          aisle_group: string
          created_at: string
          display_name: string
          id: number
          ingredient_key: string | null
          is_checked: boolean
          quantity_needed: number
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          added_from?: string
          aisle_group?: string
          created_at?: string
          display_name: string
          id?: never
          ingredient_key?: string | null
          is_checked?: boolean
          quantity_needed?: number
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          added_from?: string
          aisle_group?: string
          created_at?: string
          display_name?: string
          id?: never
          ingredient_key?: string | null
          is_checked?: boolean
          quantity_needed?: number
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      state_checkins: {
        Row: {
          context_tags: string[]
          created_at: string
          energy_score: number
          id: number
          logged_at: string
          mood_score: number
          note: string | null
          source: string
          tension_score: number | null
          user_id: string
        }
        Insert: {
          context_tags?: string[]
          created_at?: string
          energy_score: number
          id?: never
          logged_at?: string
          mood_score: number
          note?: string | null
          source?: string
          tension_score?: number | null
          user_id: string
        }
        Update: {
          context_tags?: string[]
          created_at?: string
          energy_score?: number
          id?: never
          logged_at?: string
          mood_score?: number
          note?: string | null
          source?: string
          tension_score?: number | null
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          day_slot: string
          due_date: string | null
          estimated_minutes: number | null
          follow_up_at: string | null
          goal_id: number | null
          id: number
          is_meeting: boolean
          notes: string | null
          parent_task_id: number | null
          planned_date: string | null
          priority: number
          project_id: number | null
          recurrence_rule: string | null
          remind_before_minutes: number | null
          remind_offsets_minutes: number[]
          reminder_sent_at: string | null
          reminder_snoozed_until: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          sort_order: number
          source: string
          status: string
          subtasks: Json
          tags: string[]
          title: string
          updated_at: string
          user_id: string
          waiting_context: string | null
          waiting_on_person: string | null
          waiting_since: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          day_slot?: string
          due_date?: string | null
          estimated_minutes?: number | null
          follow_up_at?: string | null
          goal_id?: number | null
          id?: never
          is_meeting?: boolean
          notes?: string | null
          parent_task_id?: number | null
          planned_date?: string | null
          priority?: number
          project_id?: number | null
          recurrence_rule?: string | null
          remind_before_minutes?: number | null
          remind_offsets_minutes?: number[]
          reminder_sent_at?: string | null
          reminder_snoozed_until?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          sort_order?: number
          source?: string
          status?: string
          subtasks?: Json
          tags?: string[]
          title: string
          updated_at?: string
          user_id: string
          waiting_context?: string | null
          waiting_on_person?: string | null
          waiting_since?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          day_slot?: string
          due_date?: string | null
          estimated_minutes?: number | null
          follow_up_at?: string | null
          goal_id?: number | null
          id?: never
          is_meeting?: boolean
          notes?: string | null
          parent_task_id?: number | null
          planned_date?: string | null
          priority?: number
          project_id?: number | null
          recurrence_rule?: string | null
          remind_before_minutes?: number | null
          remind_offsets_minutes?: number[]
          reminder_sent_at?: string | null
          reminder_snoozed_until?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          sort_order?: number
          source?: string
          status?: string
          subtasks?: Json
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
          waiting_context?: string | null
          waiting_on_person?: string | null
          waiting_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          balance_view_mode: string
          base_currency: string
          created_at: string
          daily_buffer_minutes: number
          default_available_minutes: number
          display_name: string
          feature_flags: Json
          id: string
          owner_email: string
          telegram_forum_chat_id: number | null
          telegram_topic_map: Json
          telegram_user_id: number | null
          timezone: string
          updated_at: string
        }
        Insert: {
          balance_view_mode?: string
          base_currency?: string
          created_at?: string
          daily_buffer_minutes?: number
          default_available_minutes?: number
          display_name?: string
          feature_flags?: Json
          id: string
          owner_email: string
          telegram_forum_chat_id?: number | null
          telegram_topic_map?: Json
          telegram_user_id?: number | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          balance_view_mode?: string
          base_currency?: string
          created_at?: string
          daily_buffer_minutes?: number
          default_available_minutes?: number
          display_name?: string
          feature_flags?: Json
          id?: string
          owner_email?: string
          telegram_forum_chat_id?: number | null
          telegram_topic_map?: Json
          telegram_user_id?: number | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      workout_programs: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          program_structure: Json
          sessions_per_week: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          is_active?: boolean
          program_structure?: Json
          sessions_per_week?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          is_active?: boolean
          program_structure?: Json
          sessions_per_week?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          duration_minutes: number | null
          id: number
          notes: string | null
          perceived_effort: number | null
          planned_date: string | null
          preferred_slot: string
          program_id: number | null
          session_log: Json
          status: string
          title: string
          updated_at: string
          user_id: string
          window_end_date: string
          window_start_date: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: never
          notes?: string | null
          perceived_effort?: number | null
          planned_date?: string | null
          preferred_slot?: string
          program_id?: number | null
          session_log?: Json
          status?: string
          title: string
          updated_at?: string
          user_id: string
          window_end_date: string
          window_start_date: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: never
          notes?: string | null
          perceived_effort?: number | null
          planned_date?: string | null
          preferred_slot?: string
          program_id?: number | null
          session_log?: Json
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          window_end_date?: string
          window_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_sessions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "workout_programs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_finance_balance_summary: {
        Row: {
          credit_card_grace_debt: number | null
          liquid_balance: number | null
          owed_to_me_total: number | null
          pending_reimbursements: number | null
          reserved_debts_total: number | null
          safe_to_spend: number | null
          total_balance: number | null
          total_protected_reserve: number | null
          upcoming_obligations_total: number | null
          user_id: string | null
        }
        Relationships: []
      }
      v_meal_plan_missing_ingredients: {
        Row: {
          aisle_group: string | null
          display_name: string | null
          ingredient_key: string | null
          on_hand: number | null
          to_buy: number | null
          total_needed: number | null
          unit: string | null
          user_id: string | null
        }
        Relationships: []
      }
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
  public: {
    Enums: {},
  },
} as const
