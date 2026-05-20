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
      agent_node_catalog_metadata: {
        Row: {
          agent_node_id: string
          catalog_label: string | null
          catalog_rank: number
          catalog_summary: string | null
          created_at: string
          is_catalog_enabled: boolean
          is_default: boolean
          is_featured: boolean
          is_mandatory: boolean
          review_status: string
          reviewed_at: string | null
          service_metadata: Json
          updated_at: string
        }
        Insert: {
          agent_node_id: string
          catalog_label?: string | null
          catalog_rank?: number
          catalog_summary?: string | null
          created_at?: string
          is_catalog_enabled?: boolean
          is_default?: boolean
          is_featured?: boolean
          is_mandatory?: boolean
          review_status?: string
          reviewed_at?: string | null
          service_metadata?: Json
          updated_at?: string
        }
        Update: {
          agent_node_id?: string
          catalog_label?: string | null
          catalog_rank?: number
          catalog_summary?: string | null
          created_at?: string
          is_catalog_enabled?: boolean
          is_default?: boolean
          is_featured?: boolean
          is_mandatory?: boolean
          review_status?: string
          reviewed_at?: string | null
          service_metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_node_catalog_metadata_agent_node_id_fkey"
            columns: ["agent_node_id"]
            referencedRelation: "agent_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_node_catalog_metadata_agent_node_id_fkey"
            columns: ["agent_node_id"]
            referencedRelation: "public_agent_node_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_node_install_targets: {
        Row: {
          agent_node_id: string
          archive_url: string | null
          branch: string | null
          commit_sha: string | null
          created_at: string
          expected_node_id: string
          id: string
          install_subdir: string | null
          is_enabled: boolean
          label: string | null
          manifest_path: string | null
          manifest_url: string | null
          repo_url: string | null
          source_ref: string | null
          source_type: string
          tag: string | null
          updated_at: string
        }
        Insert: {
          agent_node_id: string
          archive_url?: string | null
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          expected_node_id: string
          id?: string
          install_subdir?: string | null
          is_enabled?: boolean
          label?: string | null
          manifest_path?: string | null
          manifest_url?: string | null
          repo_url?: string | null
          source_ref?: string | null
          source_type?: string
          tag?: string | null
          updated_at?: string
        }
        Update: {
          agent_node_id?: string
          archive_url?: string | null
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          expected_node_id?: string
          id?: string
          install_subdir?: string | null
          is_enabled?: boolean
          label?: string | null
          manifest_path?: string | null
          manifest_url?: string | null
          repo_url?: string | null
          source_ref?: string | null
          source_type?: string
          tag?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_node_install_expected_identity_fk"
            columns: ["agent_node_id", "expected_node_id"]
            referencedRelation: "agent_nodes"
            referencedColumns: ["id", "expected_manifest_id"]
          },
          {
            foreignKeyName: "agent_node_install_expected_identity_fk"
            columns: ["agent_node_id", "expected_node_id"]
            referencedRelation: "public_agent_node_catalog"
            referencedColumns: ["id", "expected_manifest_id"]
          },
          {
            foreignKeyName: "agent_node_install_targets_agent_node_id_fkey"
            columns: ["agent_node_id"]
            referencedRelation: "agent_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_node_install_targets_agent_node_id_fkey"
            columns: ["agent_node_id"]
            referencedRelation: "public_agent_node_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_node_media: {
        Row: {
          agent_node_id: string
          alt_text: string | null
          caption: string | null
          created_at: string
          display_order: number
          duration_seconds: number | null
          file_size_bytes: number
          height: number | null
          id: string
          media_type: string
          mime_type: string
          owner_user_id: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          width: number | null
        }
        Insert: {
          agent_node_id: string
          alt_text?: string | null
          caption?: string | null
          created_at?: string
          display_order?: number
          duration_seconds?: number | null
          file_size_bytes: number
          height?: number | null
          id?: string
          media_type: string
          mime_type: string
          owner_user_id: string
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          agent_node_id?: string
          alt_text?: string | null
          caption?: string | null
          created_at?: string
          display_order?: number
          duration_seconds?: number | null
          file_size_bytes?: number
          height?: number | null
          id?: string
          media_type?: string
          mime_type?: string
          owner_user_id?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_node_media_node_owner_fk"
            columns: ["agent_node_id", "owner_user_id"]
            referencedRelation: "agent_nodes"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      agent_nodes: {
        Row: {
          created_at: string
          creator_discord_id: string | null
          creator_display_name: string | null
          description: string | null
          details: Json
          expected_manifest_id: string
          id: string
          is_public: boolean
          manifest: Json
          name: string
          node_type: string
          owner_user_id: string
          repo_url: string
          short_description: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_discord_id?: string | null
          creator_display_name?: string | null
          description?: string | null
          details?: Json
          expected_manifest_id: string
          id?: string
          is_public?: boolean
          manifest?: Json
          name: string
          node_type?: string
          owner_user_id: string
          repo_url: string
          short_description?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_discord_id?: string | null
          creator_display_name?: string | null
          description?: string | null
          details?: Json
          expected_manifest_id?: string
          id?: string
          is_public?: boolean
          manifest?: Json
          name?: string
          node_type?: string
          owner_user_id?: string
          repo_url?: string
          short_description?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_nodes_owner_user_id_fkey"
            columns: ["owner_user_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_nodes_owner_user_id_fkey"
            columns: ["owner_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attempts: {
        Row: {
          attempt_type: Database["public"]["Enums"]["attempt_type"]
          based_on: string | null
          child_order: number | null
          created_at: string
          deleted_at: string | null
          error_message: string | null
          id: string
          legacy_url_only: boolean
          local_file_mime: string | null
          local_file_name: string | null
          local_file_size: number | null
          local_handle_id: string | null
          name: string | null
          output_bucket: string | null
          output_path: string | null
          output_url: string | null
          pair_shot_attempt_id: string | null
          params: Json | null
          params_model: string | null
          params_prompt: string | null
          params_seed: number | null
          parent_attempt_id: string | null
          project_id: string
          slot_id: string
          starred: boolean
          status: Database["public"]["Enums"]["attempt_status"]
          storage_mode: Database["public"]["Enums"]["attempt_storage_mode"]
          superseded_by: string | null
          task_id: string | null
          thumbnail_bucket: string | null
          thumbnail_path: string | null
          thumbnail_url: string | null
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          attempt_type?: Database["public"]["Enums"]["attempt_type"]
          based_on?: string | null
          child_order?: number | null
          created_at?: string
          deleted_at?: string | null
          error_message?: string | null
          id?: string
          legacy_url_only?: boolean
          local_file_mime?: string | null
          local_file_name?: string | null
          local_file_size?: number | null
          local_handle_id?: string | null
          name?: string | null
          output_bucket?: string | null
          output_path?: string | null
          output_url?: string | null
          pair_shot_attempt_id?: string | null
          params?: Json | null
          params_model?: string | null
          params_prompt?: string | null
          params_seed?: number | null
          parent_attempt_id?: string | null
          project_id: string
          slot_id: string
          starred?: boolean
          status?: Database["public"]["Enums"]["attempt_status"]
          storage_mode?: Database["public"]["Enums"]["attempt_storage_mode"]
          superseded_by?: string | null
          task_id?: string | null
          thumbnail_bucket?: string | null
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          attempt_type?: Database["public"]["Enums"]["attempt_type"]
          based_on?: string | null
          child_order?: number | null
          created_at?: string
          deleted_at?: string | null
          error_message?: string | null
          id?: string
          legacy_url_only?: boolean
          local_file_mime?: string | null
          local_file_name?: string | null
          local_file_size?: number | null
          local_handle_id?: string | null
          name?: string | null
          output_bucket?: string | null
          output_path?: string | null
          output_url?: string | null
          pair_shot_attempt_id?: string | null
          params?: Json | null
          params_model?: string | null
          params_prompt?: string | null
          params_seed?: number | null
          parent_attempt_id?: string | null
          project_id?: string
          slot_id?: string
          starred?: boolean
          status?: Database["public"]["Enums"]["attempt_status"]
          storage_mode?: Database["public"]["Enums"]["attempt_storage_mode"]
          superseded_by?: string | null
          task_id?: string | null
          thumbnail_bucket?: string | null
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["based_on"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["based_on"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["based_on"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["based_on"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["based_on"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_local_handle_id_fkey"
            columns: ["local_handle_id"]
            referencedRelation: "local_media_handles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_slot_id_fkey"
            columns: ["slot_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "attempts_slot_id_fkey"
            columns: ["slot_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "attempts_slot_id_fkey"
            columns: ["slot_id"]
            referencedRelation: "shot_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "active_workers_health"
            referencedColumns: ["current_task_id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "normalized_task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "recent_task_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      credits_ledger: {
        Row: {
          amount: number
          created_at: string
          id: string
          metadata: Json | null
          task_id: string | null
          type: Database["public"]["Enums"]["credit_ledger_type"]
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          metadata?: Json | null
          task_id?: string | null
          type: Database["public"]["Enums"]["credit_ledger_type"]
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          task_id?: string | null
          type?: Database["public"]["Enums"]["credit_ledger_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credits_ledger_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "active_workers_health"
            referencedColumns: ["current_task_id"]
          },
          {
            foreignKeyName: "credits_ledger_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "normalized_task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_ledger_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "recent_task_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_ledger_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_ledger_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_ledger_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_tasks: {
        Row: {
          area: string | null
          commit_hash: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          discord_thread_id: string | null
          execution_details: Json | null
          id: string
          notes: string | null
          status: string
          title: string
        }
        Insert: {
          area?: string | null
          commit_hash?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          discord_thread_id?: string | null
          execution_details?: Json | null
          id?: string
          notes?: string | null
          status?: string
          title: string
        }
        Update: {
          area?: string | null
          commit_hash?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          discord_thread_id?: string | null
          execution_details?: Json | null
          id?: string
          notes?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      effects: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          name: string
          slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          name: string
          slug: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          name?: string
          slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      external_api_keys: {
        Row: {
          created_at: string
          id: string
          key_value: string
          metadata: Json | null
          service: string
          updated_at: string
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key_value: string
          metadata?: Json | null
          service: string
          updated_at?: string
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key_value?: string
          metadata?: Json | null
          service?: string
          updated_at?: string
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      generation_variants: {
        Row: {
          created_at: string
          generation_id: string
          id: string
          is_primary: boolean
          location: string
          name: string | null
          params: Json | null
          project_id: string | null
          starred: boolean
          thumbnail_url: string | null
          variant_type: string | null
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          generation_id: string
          id?: string
          is_primary?: boolean
          location: string
          name?: string | null
          params?: Json | null
          project_id?: string | null
          starred?: boolean
          thumbnail_url?: string | null
          variant_type?: string | null
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          generation_id?: string
          id?: string
          is_primary?: boolean
          location?: string
          name?: string | null
          params?: Json | null
          project_id?: string | null
          starred?: boolean
          thumbnail_url?: string | null
          variant_type?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_variants_generation_id_fkey"
            columns: ["generation_id"]
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_variants_generation_id_fkey"
            columns: ["generation_id"]
            referencedRelation: "shot_final_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_variants_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generations: {
        Row: {
          based_on: string | null
          child_order: number | null
          children: Json | null
          copied_from_share: string | null
          created_at: string
          id: string
          is_child: boolean
          local_file_mime: string | null
          local_file_name: string | null
          local_file_size: number | null
          local_handle_id: string | null
          location: string | null
          name: string | null
          pair_shot_generation_id: string | null
          params: Json | null
          parent_generation_id: string | null
          primary_variant_id: string | null
          project_id: string
          shot_data: Json | null
          starred: boolean
          storage_mode: string
          tasks: Json | null
          thumbnail_url: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          based_on?: string | null
          child_order?: number | null
          children?: Json | null
          copied_from_share?: string | null
          created_at?: string
          id?: string
          is_child?: boolean
          local_file_mime?: string | null
          local_file_name?: string | null
          local_file_size?: number | null
          local_handle_id?: string | null
          location?: string | null
          name?: string | null
          pair_shot_generation_id?: string | null
          params?: Json | null
          parent_generation_id?: string | null
          primary_variant_id?: string | null
          project_id: string
          shot_data?: Json | null
          starred?: boolean
          storage_mode?: string
          tasks?: Json | null
          thumbnail_url?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          based_on?: string | null
          child_order?: number | null
          children?: Json | null
          copied_from_share?: string | null
          created_at?: string
          id?: string
          is_child?: boolean
          local_file_mime?: string | null
          local_file_name?: string | null
          local_file_size?: number | null
          local_handle_id?: string | null
          location?: string | null
          name?: string | null
          pair_shot_generation_id?: string | null
          params?: Json | null
          parent_generation_id?: string | null
          primary_variant_id?: string | null
          project_id?: string
          shot_data?: Json | null
          starred?: boolean
          storage_mode?: string
          tasks?: Json | null
          thumbnail_url?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generations_based_on_fkey"
            columns: ["based_on"]
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_based_on_fkey"
            columns: ["based_on"]
            referencedRelation: "shot_final_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_local_handle_id_fkey"
            columns: ["local_handle_id"]
            referencedRelation: "local_media_handles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_pair_shot_generation_id_fkey"
            columns: ["pair_shot_generation_id"]
            referencedRelation: "shot_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_pair_shot_generation_id_fkey"
            columns: ["pair_shot_generation_id"]
            referencedRelation: "shot_generations_with_computed_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_parent_generation_id_fkey"
            columns: ["parent_generation_id"]
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_parent_generation_id_fkey"
            columns: ["parent_generation_id"]
            referencedRelation: "shot_final_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_primary_variant_id_fkey"
            columns: ["primary_variant_id"]
            referencedRelation: "generation_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_project_id_projects_id_fk"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      local_media_handles: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "local_media_handles_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      model_family_for_model: {
        Row: {
          model_name: string
          route_family: string
        }
        Insert: {
          model_name: string
          route_family: string
        }
        Update: {
          model_name?: string
          route_family?: string
        }
        Relationships: []
      }
      onboarding_config: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      pause_scaling: {
        Row: {
          pool: string
          reason: string | null
          until: string
        }
        Insert: {
          pool: string
          reason?: string | null
          until: string
        }
        Update: {
          pool?: string
          reason?: string | null
          until?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          aspect_ratio: string | null
          created_at: string
          id: string
          name: string
          settings: Json | null
          user_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          created_at?: string
          id?: string
          name: string
          settings?: Json | null
          user_id: string
        }
        Update: {
          aspect_ratio?: string | null
          created_at?: string
          id?: string
          name?: string
          settings?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_users_id_fk"
            columns: ["user_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_user_id_users_id_fk"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          updated_at: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      referral_sessions: {
        Row: {
          converted_at: string | null
          converted_user_id: string | null
          first_visit_at: string | null
          id: string
          is_latest_referrer: boolean | null
          last_visit_at: string | null
          referrer_user_id: string | null
          referrer_username: string
          session_id: string | null
          visit_count: number | null
          visitor_fingerprint: string | null
          visitor_ip: unknown
        }
        Insert: {
          converted_at?: string | null
          converted_user_id?: string | null
          first_visit_at?: string | null
          id?: string
          is_latest_referrer?: boolean | null
          last_visit_at?: string | null
          referrer_user_id?: string | null
          referrer_username: string
          session_id?: string | null
          visit_count?: number | null
          visitor_fingerprint?: string | null
          visitor_ip?: unknown
        }
        Update: {
          converted_at?: string | null
          converted_user_id?: string | null
          first_visit_at?: string | null
          id?: string
          is_latest_referrer?: boolean | null
          last_visit_at?: string | null
          referrer_user_id?: string | null
          referrer_username?: string
          session_id?: string | null
          visit_count?: number | null
          visitor_fingerprint?: string | null
          visitor_ip?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "referral_sessions_converted_user_id_fkey"
            columns: ["converted_user_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_sessions_converted_user_id_fkey"
            columns: ["converted_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_sessions_referrer_user_id_fkey"
            columns: ["referrer_user_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_sessions_referrer_user_id_fkey"
            columns: ["referrer_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string | null
          id: string
          referred_id: string
          referrer_id: string
          referrer_username: string
          session_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          referred_id: string
          referrer_id: string
          referrer_username: string
          session_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          referred_id?: string
          referrer_id?: string
          referrer_username?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "referral_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          created_at: string
          generation_id: string | null
          id: string
          is_public: boolean
          metadata: Json
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          generation_id?: string | null
          id?: string
          is_public?: boolean
          metadata: Json
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          generation_id?: string | null
          id?: string
          is_public?: boolean
          metadata?: Json
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_generation_id_fkey"
            columns: ["generation_id"]
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_generation_id_fkey"
            columns: ["generation_id"]
            referencedRelation: "shot_final_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_user_id_users_id_fk"
            columns: ["user_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_user_id_users_id_fk"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      route_alias_map: {
        Row: {
          alias: string
          route_key: string
        }
        Insert: {
          alias: string
          route_key: string
        }
        Update: {
          alias?: string
          route_key?: string
        }
        Relationships: []
      }
      route_backend_capabilities: {
        Row: {
          backend: string
          capability_version: number
          created_at: string
          enabled: boolean
          expires_at: string | null
          id: string
          metadata: Json
          min_worker_version: string | null
          route_key: string
          supports_missing_selector: boolean
          supports_route: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          backend: string
          capability_version?: number
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          metadata?: Json
          min_worker_version?: string | null
          route_key: string
          supports_missing_selector?: boolean
          supports_route?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          backend?: string
          capability_version?: number
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          metadata?: Json
          min_worker_version?: string | null
          route_key?: string
          supports_missing_selector?: boolean
          supports_route?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      route_backend_selectors: {
        Row: {
          created_at: string
          enabled: boolean
          expires_at: string | null
          id: string
          metadata: Json
          min_worker_version: string | null
          reason: string | null
          route_key: string
          selected_backend: string
          selector_namespace: string
          selector_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          metadata?: Json
          min_worker_version?: string | null
          reason?: string | null
          route_key: string
          selected_backend: string
          selector_namespace?: string
          selector_version: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          metadata?: Json
          min_worker_version?: string | null
          reason?: string | null
          route_key?: string
          selected_backend?: string
          selector_namespace?: string
          selector_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sentinel_ticks: {
        Row: {
          detail: Json | null
          state: string
          ts: string
        }
        Insert: {
          detail?: Json | null
          state: string
          ts?: string
        }
        Update: {
          detail?: Json | null
          state?: string
          ts?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      shared_generations: {
        Row: {
          cached_generation_data: Json | null
          cached_task_data: Json | null
          created_at: string | null
          creator_avatar_url: string | null
          creator_id: string | null
          creator_name: string | null
          creator_username: string | null
          generation_id: string
          id: string
          last_viewed_at: string | null
          share_slug: string
          shot_id: string | null
          task_id: string | null
          view_count: number | null
        }
        Insert: {
          cached_generation_data?: Json | null
          cached_task_data?: Json | null
          created_at?: string | null
          creator_avatar_url?: string | null
          creator_id?: string | null
          creator_name?: string | null
          creator_username?: string | null
          generation_id: string
          id?: string
          last_viewed_at?: string | null
          share_slug: string
          shot_id?: string | null
          task_id?: string | null
          view_count?: number | null
        }
        Update: {
          cached_generation_data?: Json | null
          cached_task_data?: Json | null
          created_at?: string | null
          creator_avatar_url?: string | null
          creator_id?: string | null
          creator_name?: string | null
          creator_username?: string | null
          generation_id?: string
          id?: string
          last_viewed_at?: string | null
          share_slug?: string
          shot_id?: string | null
          task_id?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_generations_creator_id_fkey"
            columns: ["creator_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_generations_creator_id_fkey"
            columns: ["creator_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_generations_generation_id_fkey"
            columns: ["generation_id"]
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_generations_generation_id_fkey"
            columns: ["generation_id"]
            referencedRelation: "shot_final_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_generations_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shot_statistics"
            referencedColumns: ["shot_id"]
          },
          {
            foreignKeyName: "shared_generations_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_generations_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "active_workers_health"
            referencedColumns: ["current_task_id"]
          },
          {
            foreignKeyName: "shared_generations_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "normalized_task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_generations_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "recent_task_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_generations_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      shot_data_audit: {
        Row: {
          changed_by: string | null
          created_at: string | null
          generation_id: string | null
          id: number
          new_shot_data: Json | null
          old_shot_data: Json | null
          operation: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string | null
          generation_id?: string | null
          id?: number
          new_shot_data?: Json | null
          old_shot_data?: Json | null
          operation?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string | null
          generation_id?: string | null
          id?: number
          new_shot_data?: Json | null
          old_shot_data?: Json | null
          operation?: string | null
        }
        Relationships: []
      }
      shot_generations: {
        Row: {
          created_at: string | null
          generation_id: string
          id: string
          metadata: Json | null
          shot_id: string
          timeline_frame: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string | null
          generation_id: string
          id?: string
          metadata?: Json | null
          shot_id: string
          timeline_frame?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string | null
          generation_id?: string
          id?: string
          metadata?: Json | null
          shot_id?: string
          timeline_frame?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shot_generations_generation_id_generations_id_fk"
            columns: ["generation_id"]
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_generations_generation_id_generations_id_fk"
            columns: ["generation_id"]
            referencedRelation: "shot_final_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_generations_shot_id_shots_id_fk"
            columns: ["shot_id"]
            referencedRelation: "shot_statistics"
            referencedColumns: ["shot_id"]
          },
          {
            foreignKeyName: "shot_generations_shot_id_shots_id_fk"
            columns: ["shot_id"]
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      shot_slots: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["shot_slot_kind"]
          metadata: Json | null
          position_index: number
          primary_attempt_id: string | null
          project_id: string
          shot_id: string | null
          timeline_frame: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["shot_slot_kind"]
          metadata?: Json | null
          position_index: number
          primary_attempt_id?: string | null
          project_id: string
          shot_id?: string | null
          timeline_frame?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["shot_slot_kind"]
          metadata?: Json | null
          position_index?: number
          primary_attempt_id?: string | null
          project_id?: string
          shot_id?: string | null
          timeline_frame?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shot_statistics"
            referencedColumns: ["shot_id"]
          },
          {
            foreignKeyName: "shot_slots_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      shots: {
        Row: {
          aspect_ratio: string | null
          created_at: string
          id: string
          name: string
          position: number
          project_id: string
          settings: Json | null
          updated_at: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          created_at?: string
          id?: string
          name: string
          position?: number
          project_id: string
          settings?: Json | null
          updated_at?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          created_at?: string
          id?: string
          name?: string
          position?: number
          project_id?: string
          settings?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shots_project_id_projects_id_fk"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_first_migration_map: {
        Row: {
          attempt_id: string | null
          duplicate_group_key: string | null
          id: string
          legacy_id: string
          legacy_table: string
          migrated_at: string
          notes: string | null
          slot_id: string | null
        }
        Insert: {
          attempt_id?: string | null
          duplicate_group_key?: string | null
          id?: string
          legacy_id: string
          legacy_table: string
          migrated_at?: string
          notes?: string | null
          slot_id?: string | null
        }
        Update: {
          attempt_id?: string | null
          duplicate_group_key?: string | null
          id?: string
          legacy_id?: string
          legacy_table?: string
          migrated_at?: string
          notes?: string | null
          slot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slot_first_migration_map_attempt_id_fkey"
            columns: ["attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_first_migration_map_attempt_id_fkey"
            columns: ["attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "slot_first_migration_map_attempt_id_fkey"
            columns: ["attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_first_migration_map_attempt_id_fkey"
            columns: ["attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "slot_first_migration_map_attempt_id_fkey"
            columns: ["attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_first_migration_map_slot_id_fkey"
            columns: ["slot_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "slot_first_migration_map_slot_id_fkey"
            columns: ["slot_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["slot_id"]
          },
          {
            foreignKeyName: "slot_first_migration_map_slot_id_fkey"
            columns: ["slot_id"]
            referencedRelation: "shot_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          cycle_number: number | null
          id: string
          log_level: string
          message: string
          metadata: Json | null
          source_id: string
          source_type: string
          task_id: string | null
          timestamp: string
          worker_id: string | null
        }
        Insert: {
          cycle_number?: number | null
          id?: string
          log_level: string
          message: string
          metadata?: Json | null
          source_id: string
          source_type: string
          task_id?: string | null
          timestamp?: string
          worker_id?: string | null
        }
        Update: {
          cycle_number?: number | null
          id?: string
          log_level?: string
          message?: string
          metadata?: Json | null
          source_id?: string
          source_type?: string
          task_id?: string | null
          timestamp?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      task_types: {
        Row: {
          base_cost_per_second: number
          billing_type: string
          category: string
          content_type: string | null
          cost_factors: Json | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          is_active: boolean | null
          is_visible: boolean | null
          name: string
          run_type: string
          supports_progress: boolean | null
          tool_type: string | null
          unit_cost: number | null
          updated_at: string
          variant_type: string | null
        }
        Insert: {
          base_cost_per_second: number
          billing_type?: string
          category: string
          content_type?: string | null
          cost_factors?: Json | null
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          is_visible?: boolean | null
          name: string
          run_type?: string
          supports_progress?: boolean | null
          tool_type?: string | null
          unit_cost?: number | null
          updated_at?: string
          variant_type?: string | null
        }
        Update: {
          base_cost_per_second?: number
          billing_type?: string
          category?: string
          content_type?: string | null
          cost_factors?: Json | null
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          is_visible?: boolean | null
          name?: string
          run_type?: string
          supports_progress?: boolean | null
          tool_type?: string | null
          unit_cost?: number | null
          updated_at?: string
          variant_type?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          attempts: number
          claim_decision_reason: string | null
          claim_decision_snapshot: Json | null
          claimed_backend: string | null
          claimed_capability_version: number | null
          claimed_route_key: string | null
          claimed_selector_namespace: string | null
          claimed_selector_version: number | null
          copied_from_share: string | null
          created_at: string
          dependant_on: string[] | null
          error_message: string | null
          generation_created: boolean
          generation_processed_at: string | null
          generation_started_at: string | null
          id: string
          idempotency_key: string | null
          materialized_inputs: Json | null
          model: string | null
          output_location: string | null
          params: Json
          project_id: string
          prompt: string | null
          result_data: Json | null
          route_key: string | null
          route_run_id: string | null
          route_selection_snapshot: Json | null
          seed: number | null
          selected_backend: string | null
          selected_profile: string | null
          selected_template_id: string | null
          selector_namespace: string | null
          selector_version: number | null
          status: Database["public"]["Enums"]["task_status"]
          support_state: string | null
          task_type: string
          updated_at: string | null
          worker_contract_version: number | null
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          claim_decision_reason?: string | null
          claim_decision_snapshot?: Json | null
          claimed_backend?: string | null
          claimed_capability_version?: number | null
          claimed_route_key?: string | null
          claimed_selector_namespace?: string | null
          claimed_selector_version?: number | null
          copied_from_share?: string | null
          created_at?: string
          dependant_on?: string[] | null
          error_message?: string | null
          generation_created?: boolean
          generation_processed_at?: string | null
          generation_started_at?: string | null
          id?: string
          idempotency_key?: string | null
          materialized_inputs?: Json | null
          model?: string | null
          output_location?: string | null
          params: Json
          project_id: string
          prompt?: string | null
          result_data?: Json | null
          route_key?: string | null
          route_run_id?: string | null
          route_selection_snapshot?: Json | null
          seed?: number | null
          selected_backend?: string | null
          selected_profile?: string | null
          selected_template_id?: string | null
          selector_namespace?: string | null
          selector_version?: number | null
          status?: Database["public"]["Enums"]["task_status"]
          support_state?: string | null
          task_type: string
          updated_at?: string | null
          worker_contract_version?: number | null
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          claim_decision_reason?: string | null
          claim_decision_snapshot?: Json | null
          claimed_backend?: string | null
          claimed_capability_version?: number | null
          claimed_route_key?: string | null
          claimed_selector_namespace?: string | null
          claimed_selector_version?: number | null
          copied_from_share?: string | null
          created_at?: string
          dependant_on?: string[] | null
          error_message?: string | null
          generation_created?: boolean
          generation_processed_at?: string | null
          generation_started_at?: string | null
          id?: string
          idempotency_key?: string | null
          materialized_inputs?: Json | null
          model?: string | null
          output_location?: string | null
          params?: Json
          project_id?: string
          prompt?: string | null
          result_data?: Json | null
          route_key?: string | null
          route_run_id?: string | null
          route_selection_snapshot?: Json | null
          seed?: number | null
          selected_backend?: string | null
          selected_profile?: string | null
          selected_template_id?: string | null
          selector_namespace?: string | null
          selector_version?: number | null
          status?: Database["public"]["Enums"]["task_status"]
          support_state?: string | null
          task_type?: string
          updated_at?: string | null
          worker_contract_version?: number | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_projects_id_fk"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["task_type"]
            referencedRelation: "task_types"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["task_type"]
            referencedRelation: "task_types_with_billing"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "active_workers_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "v_worker_log_activity"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "worker_performance"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_agent_sessions: {
        Row: {
          cancel_reason: string | null
          cancel_source: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          id: string
          model: string
          status: string
          summary: string | null
          timeline_id: string
          turns: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_reason?: string | null
          cancel_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          model?: string
          status?: string
          summary?: string | null
          timeline_id: string
          turns?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_reason?: string | null
          cancel_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          id?: string
          model?: string
          status?: string
          summary?: string | null
          timeline_id?: string
          turns?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_agent_sessions_timeline_id_fkey"
            columns: ["timeline_id"]
            referencedRelation: "timelines"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_checkpoints: {
        Row: {
          config: Json
          created_at: string
          edits_since_last_checkpoint: number
          id: string
          label: string
          timeline_id: string
          trigger_type: string
          user_id: string
        }
        Insert: {
          config: Json
          created_at?: string
          edits_since_last_checkpoint?: number
          id?: string
          label: string
          timeline_id: string
          trigger_type: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          edits_since_last_checkpoint?: number
          id?: string
          label?: string
          timeline_id?: string
          trigger_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_checkpoints_timeline_id_fkey"
            columns: ["timeline_id"]
            referencedRelation: "timelines"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_update_log: {
        Row: {
          call_source: string | null
          created_at: string | null
          generation_id: string
          id: string
          metadata: Json | null
          new_timeline_frame: number | null
          old_timeline_frame: number | null
          operation_type: string
          shot_id: string | null
        }
        Insert: {
          call_source?: string | null
          created_at?: string | null
          generation_id: string
          id?: string
          metadata?: Json | null
          new_timeline_frame?: number | null
          old_timeline_frame?: number | null
          operation_type: string
          shot_id?: string | null
        }
        Update: {
          call_source?: string | null
          created_at?: string | null
          generation_id?: string
          id?: string
          metadata?: Json | null
          new_timeline_frame?: number | null
          old_timeline_frame?: number | null
          operation_type?: string
          shot_id?: string | null
        }
        Relationships: []
      }
      timelines: {
        Row: {
          asset_registry: Json
          config: Json
          config_version: number
          created_at: string
          id: string
          name: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_registry?: Json
          config: Json
          config_version?: number
          created_at?: string
          id?: string
          name: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_registry?: Json
          config?: Json
          config_version?: number
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timelines_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      training_data: {
        Row: {
          batch_id: string | null
          created_at: string
          duration: number | null
          id: string
          metadata: Json | null
          original_filename: string
          storage_location: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          duration?: number | null
          id?: string
          metadata?: Json | null
          original_filename: string
          storage_location: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          duration?: number | null
          id?: string
          metadata?: Json | null
          original_filename?: string
          storage_location?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_data_batch_id_fkey"
            columns: ["batch_id"]
            referencedRelation: "training_data_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      training_data_batches: {
        Row: {
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      training_data_segments: {
        Row: {
          created_at: string
          description: string | null
          end_time: number
          id: string
          metadata: Json | null
          segment_location: string | null
          start_time: number
          training_data_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_time: number
          id?: string
          metadata?: Json | null
          segment_location?: string | null
          start_time: number
          training_data_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          end_time?: number
          id?: string
          metadata?: Json | null
          segment_location?: string | null
          start_time?: number
          training_data_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_data_segments_training_data_id_fkey"
            columns: ["training_data_id"]
            referencedRelation: "training_data"
            referencedColumns: ["id"]
          },
        ]
      }
      user_api_tokens: {
        Row: {
          created_at: string
          id: string
          label: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          api_keys: Json | null
          auto_topup_amount: number | null
          auto_topup_enabled: boolean
          auto_topup_last_triggered: string | null
          auto_topup_setup_completed: boolean
          auto_topup_threshold: number | null
          avatar_url: string | null
          credits: number
          email: string | null
          given_credits: boolean
          id: string
          name: string | null
          onboarding: Json
          onboarding_completed: boolean
          settings: Json | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          username: string | null
        }
        Insert: {
          api_keys?: Json | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_last_triggered?: string | null
          auto_topup_setup_completed?: boolean
          auto_topup_threshold?: number | null
          avatar_url?: string | null
          credits?: number
          email?: string | null
          given_credits?: boolean
          id: string
          name?: string | null
          onboarding?: Json
          onboarding_completed?: boolean
          settings?: Json | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          username?: string | null
        }
        Update: {
          api_keys?: Json | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_last_triggered?: string | null
          auto_topup_setup_completed?: boolean
          auto_topup_threshold?: number | null
          avatar_url?: string | null
          credits?: number
          email?: string | null
          given_credits?: boolean
          id?: string
          name?: string | null
          onboarding?: Json
          onboarding_completed?: boolean
          settings?: Json | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          username?: string | null
        }
        Relationships: []
      }
      workers: {
        Row: {
          created_at: string
          current_model: string | null
          id: string
          instance_type: string
          last_heartbeat: string | null
          metadata: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          current_model?: string | null
          id: string
          instance_type: string
          last_heartbeat?: string | null
          metadata?: Json | null
          status?: string
        }
        Update: {
          created_at?: string
          current_model?: string | null
          id?: string
          instance_type?: string
          last_heartbeat?: string | null
          metadata?: Json | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      active_workers_health: {
        Row: {
          created_at: string | null
          current_task_age_seconds: number | null
          current_task_id: string | null
          current_task_status: string | null
          current_task_type: string | null
          heartbeat_age_seconds: number | null
          id: string | null
          instance_type: string | null
          last_heartbeat: string | null
          status: string | null
          vram_total_mb: number | null
          vram_usage_percent: number | null
          vram_used_mb: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["current_task_type"]
            referencedRelation: "task_types"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["current_task_type"]
            referencedRelation: "task_types_with_billing"
            referencedColumns: ["name"]
          },
        ]
      }
      normalized_task_status: {
        Row: {
          id: string | null
          normalized_status: Database["public"]["Enums"]["task_status"] | null
          original_status: Database["public"]["Enums"]["task_status"] | null
        }
        Insert: {
          id?: string | null
          normalized_status?: never
          original_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Update: {
          id?: string | null
          normalized_status?: never
          original_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Relationships: []
      }
      orchestrator_status: {
        Row: {
          active_workers: number | null
          completed_tasks: number | null
          error_tasks: number | null
          external_workers: number | null
          failed_tasks: number | null
          inactive_workers: number | null
          queued_tasks: number | null
          running_tasks: number | null
          snapshot_time: string | null
          stale_workers: number | null
          stuck_tasks: number | null
          terminated_workers: number | null
        }
        Relationships: []
      }
      project_asset_compositions: {
        Row: {
          attempt_id: string | null
          attempt_type: Database["public"]["Enums"]["attempt_type"] | null
          child_order: number | null
          created_at: string | null
          duration_seconds: number | null
          error_message: string | null
          id: string | null
          kind: Database["public"]["Enums"]["shot_slot_kind"] | null
          legacy_url_only: boolean | null
          local_file_mime: string | null
          local_file_name: string | null
          local_file_size: number | null
          local_handle_id: string | null
          location: string | null
          name: string | null
          output_bucket: string | null
          output_path: string | null
          output_url: string | null
          pair_shot_attempt_id: string | null
          params: Json | null
          parent_attempt_id: string | null
          position_index: number | null
          primary_attempt_id: string | null
          primary_status: Database["public"]["Enums"]["attempt_status"] | null
          project_id: string | null
          shot_id: string | null
          slot_created_at: string | null
          slot_id: string | null
          slot_metadata: Json | null
          slot_updated_at: string | null
          starred: boolean | null
          storage_mode:
            | Database["public"]["Enums"]["attempt_storage_mode"]
            | null
          superseded_by: string | null
          task_id: string | null
          thumbnail_bucket: string | null
          thumbnail_path: string | null
          thumbnail_url: string | null
          timeline_frame: number | null
          type: Database["public"]["Enums"]["attempt_type"] | null
          updated_at: string | null
          variant_fetch_attempt_id: string | null
          viewed_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_local_handle_id_fkey"
            columns: ["local_handle_id"]
            referencedRelation: "local_media_handles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "active_workers_health"
            referencedColumns: ["current_task_id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "normalized_task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "recent_task_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shot_statistics"
            referencedColumns: ["shot_id"]
          },
          {
            foreignKeyName: "shot_slots_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      public_agent_node_catalog: {
        Row: {
          catalog_label: string | null
          catalog_rank: number | null
          catalog_summary: string | null
          created_at: string | null
          creator_discord_id: string | null
          creator_display_name: string | null
          description: string | null
          expected_manifest_id: string | null
          id: string | null
          is_default: boolean | null
          is_featured: boolean | null
          is_mandatory: boolean | null
          name: string | null
          node_type: string | null
          repo_url: string | null
          short_description: string | null
          slug: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      public_agent_node_install_targets: {
        Row: {
          agent_node_id: string | null
          archive_url: string | null
          branch: string | null
          commit_sha: string | null
          created_at: string | null
          expected_node_id: string | null
          id: string | null
          install_subdir: string | null
          label: string | null
          manifest_path: string | null
          manifest_url: string | null
          repo_url: string | null
          source_ref: string | null
          source_type: string | null
          tag: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_node_install_expected_identity_fk"
            columns: ["agent_node_id", "expected_node_id"]
            referencedRelation: "agent_nodes"
            referencedColumns: ["id", "expected_manifest_id"]
          },
          {
            foreignKeyName: "agent_node_install_expected_identity_fk"
            columns: ["agent_node_id", "expected_node_id"]
            referencedRelation: "public_agent_node_catalog"
            referencedColumns: ["id", "expected_manifest_id"]
          },
          {
            foreignKeyName: "agent_node_install_targets_agent_node_id_fkey"
            columns: ["agent_node_id"]
            referencedRelation: "agent_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_node_install_targets_agent_node_id_fkey"
            columns: ["agent_node_id"]
            referencedRelation: "public_agent_node_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      public_agent_node_media: {
        Row: {
          agent_node_id: string | null
          alt_text: string | null
          caption: string | null
          created_at: string | null
          display_order: number | null
          duration_seconds: number | null
          file_size_bytes: number | null
          height: number | null
          id: string | null
          media_type: string | null
          mime_type: string | null
          storage_bucket: string | null
          storage_path: string | null
          width: number | null
        }
        Relationships: []
      }
      recent_task_activity: {
        Row: {
          attempts: number | null
          created_at: string | null
          error_message: string | null
          generation_processed_at: string | null
          generation_started_at: string | null
          id: string | null
          processing_duration_seconds: number | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_type: string | null
          updated_at: string | null
          worker_id: string | null
          worker_instance_type: string | null
          worker_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["task_type"]
            referencedRelation: "task_types"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["task_type"]
            referencedRelation: "task_types_with_billing"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "active_workers_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "v_worker_log_activity"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "worker_performance"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tasks_worker_id_fkey"
            columns: ["worker_id"]
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_stats: {
        Row: {
          conversion_rate_percent: number | null
          conversions: number | null
          id: string | null
          name: string | null
          successful_referrals: number | null
          total_visits: number | null
          username: string | null
        }
        Relationships: []
      }
      shot_compositions: {
        Row: {
          attempt_id: string | null
          attempt_type: Database["public"]["Enums"]["attempt_type"] | null
          child_order: number | null
          created_at: string | null
          duration_seconds: number | null
          error_message: string | null
          id: string | null
          kind: Database["public"]["Enums"]["shot_slot_kind"] | null
          legacy_url_only: boolean | null
          local_file_mime: string | null
          local_file_name: string | null
          local_file_size: number | null
          local_handle_id: string | null
          location: string | null
          name: string | null
          output_bucket: string | null
          output_path: string | null
          output_url: string | null
          pair_shot_attempt_id: string | null
          params: Json | null
          parent_attempt_id: string | null
          position_index: number | null
          primary_attempt_id: string | null
          primary_status: Database["public"]["Enums"]["attempt_status"] | null
          project_id: string | null
          shot_id: string | null
          slot_created_at: string | null
          slot_id: string | null
          slot_metadata: Json | null
          slot_updated_at: string | null
          starred: boolean | null
          storage_mode:
            | Database["public"]["Enums"]["attempt_storage_mode"]
            | null
          superseded_by: string | null
          task_id: string | null
          thumbnail_bucket: string | null
          thumbnail_path: string | null
          thumbnail_url: string | null
          timeline_frame: number | null
          type: Database["public"]["Enums"]["attempt_type"] | null
          updated_at: string | null
          variant_fetch_attempt_id: string | null
          viewed_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_based_on_fkey"
            columns: ["variant_fetch_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_local_handle_id_fkey"
            columns: ["local_handle_id"]
            referencedRelation: "local_media_handles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_pair_shot_attempt_id_fkey"
            columns: ["pair_shot_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_parent_attempt_id_fkey"
            columns: ["parent_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "attempts_superseded_by_fkey"
            columns: ["superseded_by"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "active_workers_health"
            referencedColumns: ["current_task_id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "normalized_task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "recent_task_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_task_id_fkey"
            columns: ["task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "project_asset_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["attempt_id"]
          },
          {
            foreignKeyName: "shot_slots_primary_attempt_fk"
            columns: ["primary_attempt_id"]
            referencedRelation: "shot_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_slots_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shot_statistics"
            referencedColumns: ["shot_id"]
          },
          {
            foreignKeyName: "shot_slots_shot_id_fkey"
            columns: ["shot_id"]
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      shot_final_videos: {
        Row: {
          created_at: string | null
          duration_seconds: number | null
          id: string | null
          location: string | null
          params: Json | null
          project_id: string | null
          shot_id: string | null
          starred: boolean | null
          thumbnail_url: string | null
          type: string | null
          updated_at: string | null
          variant_fetch_generation_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generations_project_id_projects_id_fk"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_generations_shot_id_shots_id_fk"
            columns: ["shot_id"]
            referencedRelation: "shot_statistics"
            referencedColumns: ["shot_id"]
          },
          {
            foreignKeyName: "shot_generations_shot_id_shots_id_fk"
            columns: ["shot_id"]
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      shot_generations_with_computed_position: {
        Row: {
          computed_position: number | null
          created_at: string | null
          generation_id: string | null
          id: string | null
          metadata: Json | null
          shot_id: string | null
          timeline_frame: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shot_generations_generation_id_generations_id_fk"
            columns: ["generation_id"]
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_generations_generation_id_generations_id_fk"
            columns: ["generation_id"]
            referencedRelation: "shot_final_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_generations_shot_id_shots_id_fk"
            columns: ["shot_id"]
            referencedRelation: "shot_statistics"
            referencedColumns: ["shot_id"]
          },
          {
            foreignKeyName: "shot_generations_shot_id_shots_id_fk"
            columns: ["shot_id"]
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      shot_statistics: {
        Row: {
          final_video_count: number | null
          positioned_count: number | null
          project_id: string | null
          shot_id: string | null
          total_generations: number | null
          unpositioned_count: number | null
          video_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shots_project_id_projects_id_fk"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_first_health: {
        Row: {
          attempt_project_drift_count: number | null
          attempts_failed_total: number | null
          attempts_pending: number | null
          attempts_total: number | null
          based_on_cross_project_count: number | null
          based_on_cross_slot_count: number | null
          complete_remote_missing_storage_identity: number | null
          duplicate_child_order_retry_groups: number | null
          duplicate_pair_retry_groups: number | null
          legacy_url_only_attempts_total: number | null
          local_attempts_missing_valid_handle: number | null
          no_shot_non_project_asset_count: number | null
          nonlocal_attempts_with_local_metadata: number | null
          nullable_child_attempts_total: number | null
          pair_cross_project_count: number | null
          parent_cross_project_count: number | null
          primary_cross_project_count: number | null
          primary_cross_slot_count: number | null
          primary_deleted_count: number | null
          primary_not_renderable: number | null
          project_asset_compositions_empty_primary_rows: number | null
          project_asset_compositions_total: number | null
          project_asset_slots_total: number | null
          project_asset_slots_without_primary: number | null
          project_asset_with_shot_count: number | null
          route_capabilities_active: number | null
          route_selectors_active: number | null
          sampled_at: string | null
          self_lineage_count: number | null
          self_parent_count: number | null
          shot_bound_slots_total: number | null
          shot_bound_slots_without_primary: number | null
          shot_compositions_empty_primary_rows: number | null
          slot_density_gap_groups: number | null
          slot_project_drift_count: number | null
          slots_total: number | null
          slots_without_primary: number | null
          superseded_boundary_violation_count: number | null
          task_ghost_count: number | null
        }
        Relationships: []
      }
      task_queue_analysis: {
        Row: {
          avg_processing_time_seconds: number | null
          avg_queue_time_minutes: number | null
          error_count: number | null
          max_queue_time_minutes: number | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_count: number | null
          task_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["task_type"]
            referencedRelation: "task_types"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "tasks_task_type_fkey"
            columns: ["task_type"]
            referencedRelation: "task_types_with_billing"
            referencedColumns: ["name"]
          },
        ]
      }
      task_types_with_billing: {
        Row: {
          base_cost_per_second: number | null
          billing_type: string | null
          category: string | null
          cost_factors: Json | null
          created_at: string | null
          description: string | null
          display_name: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          primary_cost: number | null
          run_type: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          base_cost_per_second?: number | null
          billing_type?: string | null
          category?: string | null
          cost_factors?: Json | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          primary_cost?: never
          run_type?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          base_cost_per_second?: number | null
          billing_type?: string | null
          category?: string | null
          cost_factors?: Json | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          primary_cost?: never
          run_type?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_credit_balance: {
        Row: {
          balance: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credits_ledger_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "referral_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_ledger_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      v_recent_errors: {
        Row: {
          error_count: number | null
          last_error_time: string | null
          source_id: string | null
          source_type: string | null
          task_id: string | null
          unique_messages: string[] | null
          worker_id: string | null
        }
        Relationships: []
      }
      v_worker_log_activity: {
        Row: {
          error_count: number | null
          last_heartbeat: string | null
          last_log_time: string | null
          log_count: number | null
          status: string | null
          warning_count: number | null
          worker_id: string | null
        }
        Relationships: []
      }
      worker_performance: {
        Row: {
          avg_processing_time_seconds: number | null
          completed_tasks: number | null
          current_running_tasks: number | null
          error_tasks: number | null
          failed_tasks: number | null
          instance_type: string | null
          last_heartbeat: string | null
          status: string | null
          success_rate_percent: number | null
          total_tasks_processed: number | null
          uptime_hours: number | null
          worker_created_at: string | null
          worker_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _duplicate_shot_with_videos_remap_jsonb: {
        Args: {
          p_generation_id_map: Json
          p_new_shot_id: string
          p_shot_generation_id_map: Json
          p_source_shot_id: string
          p_value: Json
        }
        Returns: Json
      }
      _route_slug: { Args: { p_value: string }; Returns: string }
      add_generation_to_shot: {
        Args: {
          p_generation_id: string
          p_shot_id: string
          p_with_position?: boolean
        }
        Returns: {
          generation_id: string
          id: string
          shot_id: string
          timeline_frame: number
        }[]
      }
      all_dependencies_complete: {
        Args: { p_dependant_on: string[] }
        Returns: boolean
      }
      analyze_task_availability_service_role: {
        Args: { p_include_active?: boolean; p_run_type?: string }
        Returns: Json
      }
      analyze_task_availability_user:
        | {
            Args: { p_include_active?: boolean; p_user_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_include_active?: boolean
              p_run_type?: string
              p_user_id: string
            }
            Returns: {
              in_progress_tasks: number
              queued_tasks: number
              run_type: string
              task_breakdown: Json
              total_tasks: number
            }[]
          }
      analyze_task_availability_user_pat: {
        Args: { p_include_active?: boolean; p_user_id: string }
        Returns: Json
      }
      apply_timeline_frames: {
        Args: {
          p_changes: Json
          p_shot_id: string
          p_update_positions?: boolean
        }
        Returns: {
          generation_id: string
          id: string
          position: number
          timeline_frame: number
          updated_at: string
        }[]
      }
      auto_fail_stale_tasks: { Args: never; Returns: number }
      auto_register_worker: {
        Args: { p_instance_type?: string; p_worker_id: string }
        Returns: undefined
      }
      batch_update_timeline_frames: { Args: { p_updates: Json }; Returns: Json }
      batch_update_timeline_positions: {
        Args: { updates: Json }
        Returns: {
          error_message: string
          generation_id: string
          id: string
          success: boolean
          timeline_frame: number
        }[]
      }
      bytea_to_text: { Args: { data: string }; Returns: string }
      cascade_task_failure: {
        Args: {
          p_failed_task_id: string
          p_failure_status: string
          p_is_orchestrator_task: boolean
          p_orchestrator_task_id: string
        }
        Returns: string[]
      }
      check_rate_limit: {
        Args: {
          p_key: string
          p_max_requests: number
          p_window_seconds: number
        }
        Returns: Json
      }
      check_shot_generations_functions: {
        Args: never
        Returns: {
          function_definition: string
          function_name: string
        }[]
      }
      check_shot_generations_triggers: {
        Args: never
        Returns: {
          trigger_definition: string
          trigger_enabled: boolean
          trigger_name: string
          trigger_type: string
        }[]
      }
      check_welcome_bonus_eligibility: {
        Args: never
        Returns: {
          already_had_bonus: boolean
          current_credits_balance: number
          eligible: boolean
          message: string
        }[]
      }
      claim_next_task_service_role:
        | {
            Args: {
              p_include_active?: boolean
              p_run_type?: string
              p_worker_id: string
            }
            Returns: {
              params: Json
              project_id: string
              task_id: string
              task_type: string
              user_id: string
            }[]
          }
        | {
            Args: {
              p_include_active?: boolean
              p_max_task_wait_minutes?: number
              p_run_type?: string
              p_same_model_only?: boolean
              p_selector_namespace?: string
              p_worker_backend?: string
              p_worker_id: string
            }
            Returns: {
              claim_decision_reason: string
              claim_decision_snapshot: Json
              claimed_backend: string
              claimed_capability_version: number
              claimed_route_key: string
              claimed_selector_namespace: string
              claimed_selector_version: number
              params: Json
              project_id: string
              route_key: string
              route_selection_snapshot: Json
              selected_backend: string
              selector_namespace: string
              selector_version: number
              task_id: string
              task_route_key: string
              task_route_selection_snapshot: Json
              task_selected_backend: string
              task_selector_namespace: string
              task_selector_version: number
              task_type: string
              user_id: string
            }[]
          }
      claim_next_task_user: {
        Args: {
          p_include_active?: boolean
          p_run_type?: string
          p_user_id: string
        }
        Returns: {
          params: Json
          project_id: string
          task_id: string
          task_type: string
          user_id: string
        }[]
      }
      claim_next_task_user_pat: {
        Args: {
          p_include_active?: boolean
          p_run_type?: string
          p_user_id: string
        }
        Returns: {
          params: Json
          project_id: string
          task_id: string
          task_type: string
          user_id: string
        }[]
      }
      cleanup_old_rate_limits: { Args: never; Returns: number }
      complete_task_with_timing: {
        Args: { p_output_location: string; p_task_id: string }
        Returns: boolean
      }
      copy_onboarding_template: {
        Args: { target_project_id: string; target_shot_id: string }
        Returns: undefined
      }
      copy_onboarding_template_admin: {
        Args: { target_project_id: string; target_shot_id: string }
        Returns: undefined
      }
      copy_shot_from_share: {
        Args: { share_slug_param: string; target_project_id: string }
        Returns: string
      }
      count_eligible_tasks_service_role: {
        Args: {
          p_include_active?: boolean
          p_run_type?: string
          p_selector_namespace?: string
          p_worker_backend?: string
        }
        Returns: number
      }
      count_eligible_tasks_user: {
        Args: {
          p_include_active?: boolean
          p_run_type?: string
          p_user_id: string
        }
        Returns: number
      }
      count_eligible_tasks_user_pat: {
        Args: { p_include_active?: boolean; p_user_id: string }
        Returns: number
      }
      count_queued_tasks_breakdown_service_role: {
        Args: {
          p_run_type?: string
          p_selector_namespace?: string
          p_worker_backend?: string
        }
        Returns: {
          blocked_by_capacity: number
          blocked_by_deps: number
          blocked_by_settings: number
          claimable_now: number
          total_queued: number
        }[]
      }
      count_unpositioned_generations: {
        Args: { p_shot_id: string }
        Returns: number
      }
      create_referral_from_session: {
        Args: { p_fingerprint: string; p_session_id: string }
        Returns: string
      }
      create_shot_with_generations: {
        Args: {
          p_generation_ids: string[]
          p_project_id: string
          p_shot_name: string
        }
        Returns: Json
      }
      create_shot_with_image: {
        Args: {
          p_generation_id: string
          p_project_id: string
          p_shot_name: string
        }
        Returns: {
          shot_generation_id: string
          shot_id: string
          shot_name: string
          success: boolean
        }[]
      }
      create_user_record_if_not_exists: { Args: never; Returns: undefined }
      debug_timeline_update: {
        Args: {
          p_generation_id: string
          p_metadata?: Json
          p_new_timeline_frame: number
          p_shot_id: string
        }
        Returns: Json
      }
      delete_and_normalize: {
        Args: { p_shot_generation_id: string; p_shot_id: string }
        Returns: Json
      }
      delete_external_api_key: { Args: { p_service: string }; Returns: Json }
      delete_project_with_extended_timeout: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      demote_orphaned_video_variants: {
        Args: { p_shot_id: string }
        Returns: number
      }
      derive_route_key: {
        Args: { p_params: Json; p_task_type: string }
        Returns: string
      }
      duplicate_as_new_generation: {
        Args: {
          p_generation_id: string
          p_next_timeline_frame?: number
          p_project_id: string
          p_shot_id: string
          p_timeline_frame: number
        }
        Returns: Json
      }
      duplicate_shot: {
        Args: { original_shot_id: string; project_id: string }
        Returns: string
      }
      duplicate_shot_generations: {
        Args: { p_source_shot_id: string; p_target_shot_id: string }
        Returns: {
          inserted_count: number
          skipped_unpositioned: number
          skipped_videos: number
        }[]
      }
      duplicate_shot_with_videos: {
        Args: { original_shot_id: string; project_id: string }
        Returns: Json
      }
      ensure_shot_association_from_params: {
        Args: { p_generation_id: string; p_params: Json }
        Returns: boolean
      }
      ensure_shot_parent_generation: {
        Args: { p_project_id?: string; p_shot_id: string }
        Returns: string
      }
      extract_discord_username: {
        Args: { jwt_claims: Json; user_metadata: Json }
        Returns: string
      }
      fix_timeline_spacing: {
        Args: { p_shot_id: string }
        Returns: {
          details: string
          generation_id: string
          id: string
          new_timeline_frame: number
          old_timeline_frame: number
          updated: boolean
          violation_type: string
        }[]
      }
      func_claim_available_task: {
        Args: { worker_id_param: string }
        Returns: {
          attempts: number
          created_at: string
          generation_started_at: string
          id: string
          status: string
          task_data: Json
          task_type: string
          worker_id: string
        }[]
      }
      func_cleanup_old_logs: {
        Args: { retention_hours?: number }
        Returns: Json
      }
      func_daily_task_stats: {
        Args: never
        Returns: {
          date: string
          images_edited: number
          images_generated: number
          videos_generated: number
        }[]
      }
      func_get_tasks_by_status: {
        Args: { status_filter: string[] }
        Returns: {
          attempts: number
          created_at: string
          generation_processed_at: string
          generation_started_at: string
          id: string
          status: string
          task_data: Json
          worker_id: string
        }[]
      }
      func_initialize_tasks_table: {
        Args: { p_table_name?: string }
        Returns: string
      }
      func_insert_logs_batch: { Args: { logs: Json }; Returns: Json }
      func_mark_task_complete: {
        Args: { result_data_param?: Json; task_id_param: string }
        Returns: undefined
      }
      func_mark_task_failed:
        | {
            Args: { p_error_message: string; p_task_id: string }
            Returns: boolean
          }
        | {
            Args: { error_message_param?: string; task_id_param: string }
            Returns: undefined
          }
      func_migrate_tasks_for_task_type: {
        Args: { p_table_name?: string }
        Returns: string
      }
      func_reset_orphaned_tasks: {
        Args: { failed_worker_ids: string[] }
        Returns: number
      }
      func_update_task_status: {
        Args: {
          p_output_location?: string
          p_status: string
          p_table_name?: string
          p_task_id: string
        }
        Returns: boolean
      }
      func_update_worker_heartbeat: {
        Args: {
          vram_total_mb_param?: number
          vram_used_mb_param?: number
          worker_id_param: string
        }
        Returns: undefined
      }
      func_worker_heartbeat_with_logs:
        | {
            Args: {
              current_task_id_param?: string
              logs_param?: Json
              vram_total_mb_param?: number
              vram_used_mb_param?: number
              worker_id_param: string
            }
            Returns: Json
          }
        | {
            Args: {
              current_task_id_param?: string
              logs_param?: Json
              status_param?: string
              vram_total_mb_param?: number
              vram_used_mb_param?: number
              worker_id_param: string
            }
            Returns: Json
          }
      get_attempt_lineage: {
        Args: {
          p_attempt_id: string
          p_direction?: string
          p_max_depth?: number
        }
        Returns: {
          attempt_id: string
          attempt_type: Database["public"]["Enums"]["attempt_type"]
          based_on: string
          child_order: number
          created_at: string
          depth: number
          pair_shot_attempt_id: string
          parent_attempt_id: string
          project_id: string
          slot_id: string
          status: Database["public"]["Enums"]["attempt_status"]
          via_relation: string
        }[]
      }
      get_external_api_key_decrypted: {
        Args: { p_service: string; p_user_id: string }
        Returns: {
          created_at: string
          id: string
          key_value: string
          metadata: Json
          service: string
          updated_at: string
        }[]
      }
      get_recent_timeline_updates: {
        Args: { p_generation_id?: string; p_minutes?: number }
        Returns: {
          call_source: string
          created_at: string
          generation_id: string
          log_id: string
          new_frame: number
          old_frame: number
          operation_type: string
          shot_id: string
        }[]
      }
      get_shared_shot_data: {
        Args: { share_slug_param: string }
        Returns: Json
      }
      get_task_cost: {
        Args: {
          p_duration_seconds?: number
          p_task_type: string
          p_unit_count?: number
        }
        Returns: number
      }
      get_task_model: { Args: { p_params: Json }; Returns: string }
      get_task_run_type: { Args: { p_task_type: string }; Returns: string }
      get_timeline_version: { Args: { p_timeline_id: string }; Returns: number }
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
        Returns: boolean
      }
      increment_share_view_count: {
        Args: { share_slug_param: string }
        Returns: undefined
      }
      initialize_timeline_frames_for_shot: {
        Args: { p_frame_spacing?: number; p_shot_id: string }
        Returns: number
      }
      insert_shot_at_position: {
        Args: { p_position: number; p_project_id: string; p_shot_name: string }
        Returns: {
          shot_id: string
          shot_name: string
          shot_position: number
          success: boolean
        }[]
      }
      normalize_image_path: { Args: { image_path: string }; Returns: string }
      normalize_image_paths_in_jsonb: { Args: { data: Json }; Returns: Json }
      normalize_shot_timeline: {
        Args: { p_shot_id: string; p_user_id: string }
        Returns: Json
      }
      per_user_capacity_stats_service_role: {
        Args: never
        Returns: {
          allows_cloud: boolean
          at_limit: boolean
          credits: number
          in_progress_tasks: number
          queued_tasks: number
          user_id: string
        }[]
      }
      reorder_normalized: {
        Args: { p_new_order: string[]; p_shot_id: string }
        Returns: Json
      }
      route_backend_claim_decision: {
        Args: {
          p_now?: string
          p_route_key: string
          p_selector_namespace: string
          p_worker_backend: string
        }
        Returns: {
          capability_present: boolean
          capability_snapshot: Json
          capability_supports_missing_selector: boolean
          capability_supports_route: boolean
          capability_version: number
          decision_reason: string
          eligible: boolean
          route_key: string
          selected_backend: string
          selector_enabled: boolean
          selector_expired: boolean
          selector_namespace: string
          selector_present: boolean
          selector_snapshot: Json
          selector_version: number
          worker_backend: string
        }[]
      }
      run_shot_sync_check: { Args: never; Returns: number }
      safe_bigint_from_text: { Args: { p_value: string }; Returns: number }
      safe_insert_task: {
        Args: {
          p_dependant_on?: string
          p_id: string
          p_params: Json
          p_project_id: string
          p_status?: string
          p_task_type: string
        }
        Returns: string
      }
      safe_numeric_from_text: { Args: { p_value: string }; Returns: number }
      safe_update_task_status: {
        Args: {
          p_generation_started_at?: string
          p_status: string
          p_task_id: string
          p_worker_id?: string
        }
        Returns: boolean
      }
      sanitize_discord_handle: { Args: { handle: string }; Returns: string }
      save_external_api_key: {
        Args: { p_key_value: string; p_metadata?: Json; p_service: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slot_first_assert_project_access: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      slot_first_attempt_is_renderable: {
        Args: {
          p_deleted_at: string
          p_legacy_url_only?: boolean
          p_local_handle_id: string
          p_output_bucket: string
          p_output_path: string
          p_output_url: string
          p_status: string
          p_storage_mode: string
        }
        Returns: boolean
      }
      slot_first_complete_attempt: {
        Args: {
          p_attempt_id: string
          p_local_handle_id?: string
          p_output_bucket: string
          p_output_path: string
          p_output_url: string
          p_storage_mode?: Database["public"]["Enums"]["attempt_storage_mode"]
          p_thumbnail_bucket?: string
          p_thumbnail_path?: string
          p_thumbnail_url?: string
        }
        Returns: undefined
      }
      slot_first_create_composition_child_attempt: {
        Args: {
          p_attempt_type?: Database["public"]["Enums"]["attempt_type"]
          p_based_on?: string
          p_child_order?: number
          p_pair_shot_attempt_id?: string
          p_params?: Json
          p_parent_attempt_id: string
          p_slot_id: string
          p_task_id?: string
        }
        Returns: string
      }
      slot_first_create_pending_attempt: {
        Args: {
          p_attempt_type?: Database["public"]["Enums"]["attempt_type"]
          p_based_on?: string
          p_params?: Json
          p_slot_id: string
          p_task_id?: string
        }
        Returns: string
      }
      slot_first_delete_attempt: {
        Args: { p_attempt_id: string; p_hard?: boolean }
        Returns: undefined
      }
      slot_first_duration_seconds: { Args: { p_params: Json }; Returns: number }
      slot_first_fail_attempt: {
        Args: { p_attempt_id: string; p_error_message?: string }
        Returns: undefined
      }
      slot_first_log_primary_changed: {
        Args: {
          p_new_attempt_id: string
          p_previous_attempt_id: string
          p_slot_id: string
          p_source?: string
        }
        Returns: undefined
      }
      slot_first_mark_attempt_in_progress: {
        Args: { p_attempt_id: string }
        Returns: undefined
      }
      slot_first_promote_attempt: {
        Args: { p_attempt_id: string; p_slot_id: string }
        Returns: undefined
      }
      slot_first_reorder_slots: {
        Args: {
          p_kind: Database["public"]["Enums"]["shot_slot_kind"]
          p_ordered_slot_ids: string[]
          p_shot_id: string
        }
        Returns: undefined
      }
      slot_first_shared_shot_data: {
        Args: { p_share_slug: string }
        Returns: Json
      }
      slot_first_validate_slot_density: {
        Args: {
          p_kind?: Database["public"]["Enums"]["shot_slot_kind"]
          p_project_id?: string
          p_shot_id?: string
        }
        Returns: undefined
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
      timeline_sync_bulletproof: {
        Args: {
          frame_changes: Json
          shot_uuid: string
          should_update_positions?: boolean
        }
        Returns: {
          frame_value: number
          gen_uuid: string
          last_updated: string
          record_id: string
        }[]
      }
      track_referral_visit: {
        Args: {
          p_referrer_username: string
          p_session_id?: string
          p_visitor_fingerprint?: string
          p_visitor_ip?: unknown
        }
        Returns: string
      }
      unposition_and_normalize: {
        Args: { p_shot_generation_id: string; p_shot_id: string }
        Returns: Json
      }
      update_shot_image_order_disabled: {
        Args: {
          p_ordered_shot_generation_ids: string[]
          p_project_id: string
          p_shot_id: string
        }
        Returns: Json
      }
      update_single_timeline_frame: {
        Args: {
          p_generation_id: string
          p_metadata: Json
          p_new_timeline_frame: number
        }
        Returns: {
          created_at: string | null
          generation_id: string
          id: string
          metadata: Json | null
          shot_id: string
          timeline_frame: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "shot_generations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_timeline_config_versioned: {
        Args: {
          p_config: Json
          p_expected_version: number
          p_timeline_id: string
        }
        Returns: {
          config_version: number
        }[]
      }
      update_timeline_frame_debug: {
        Args: {
          p_generation_id: string
          p_metadata?: Json
          p_new_timeline_frame: number
          p_shot_id: string
        }
        Returns: Json
      }
      update_timeline_versioned: {
        Args: {
          p_asset_registry: Json
          p_config: Json
          p_expected_version: number
          p_timeline_id: string
        }
        Returns: {
          config_version: number
        }[]
      }
      update_tool_settings_atomic: {
        Args: {
          p_id: string
          p_settings: Json
          p_table_name: string
          p_tool_id: string
        }
        Returns: undefined
      }
      upsert_asset_registry_entry: {
        Args: { p_asset_id: string; p_entry: Json; p_timeline_id: string }
        Returns: undefined
      }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      verify_api_token: { Args: { p_token: string }; Returns: boolean }
      verify_referral_security: {
        Args: never
        Returns: {
          anon_permissions: string[]
          auth_permissions: string[]
          policy_count: number
          rls_enabled: boolean
          table_name: string
        }[]
      }
      verify_shot_sync: {
        Args: never
        Returns: {
          gen_frame: number
          gen_shot_id: string
          generation_id: string
          sg_frame: number
          sg_shot_id: string
          status: string
        }[]
      }
    }
    Enums: {
      attempt_status:
        | "queued"
        | "in_progress"
        | "complete"
        | "failed"
        | "cancelled"
      attempt_storage_mode: "remote" | "local" | "uploading"
      attempt_type:
        | "original"
        | "regen"
        | "edit"
        | "upscale"
        | "reposition"
        | "duplicate"
      credit_ledger_type:
        | "stripe"
        | "manual"
        | "spend"
        | "refund"
        | "auto_topup"
      shot_slot_kind:
        | "image"
        | "video_segment"
        | "timeline_placement"
        | "project_asset"
      task_status:
        | "Queued"
        | "In Progress"
        | "Complete"
        | "Failed"
        | "Cancelled"
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
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
