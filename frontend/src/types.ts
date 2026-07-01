export interface Column {
  id: string;
  asset_id: string;
  name: string;
  datatype: string;
  nullable_percentage?: number;
  distinct_count?: number;
  duplicate_count?: number;
  min?: string;
  max?: string;
  mean?: number;
  median?: number;
  sample_values?: any[];
  description?: string;
  notes?: string;
  tags?: string[];
  custom_attributes?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  name: string;
  asset_type: string;
  description?: string;
  owner?: string;
  version: number;
  row_count?: number;
  column_count?: number;
  file_size?: number;
  notes?: string;
  tags?: string[];
  custom_attributes?: Record<string, any>;
  created_at: string;
  updated_at: string;
  columns?: Column[];
}

export interface Relationship {
  id: string;
  source_node_type: 'asset' | 'column';
  source_node_id: string;
  destination_node_type: 'asset' | 'column';
  destination_node_id: string;
  relationship_type: 'DERIVES_FROM' | 'MAPS_TO' | 'LOOKUP_FROM' | 'COPIED_FROM';
  metadata_json?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface VersionHistory {
  id: string;
  asset_id: string;
  version_number: number;
  change_summary?: string;
  metadata_snapshot: Record<string, any>;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  activity_type: string;
  details: string;
  asset_id?: string;
  created_at: string;
}

export interface SearchResultItem {
  id: string;
  name: string;
  type: 'asset' | 'column';
  asset_id?: string;
  asset_name?: string;
  match_field: string;
  match_value: string;
  preview: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
}

export type WSBroadcastEvent =
  | { event_type: 'asset_created'; data: { id: string; name: string; row_count: number; column_count: number } }
  | { event_type: 'asset_updated'; data: { id: string; name: string; version: number; updates: Partial<Asset> } }
  | { event_type: 'asset_deleted'; data: { id: string; name: string } }
  | { event_type: 'column_updated'; data: { id: string; asset_id: string; name: string; updates: Partial<Column> } }
  | { event_type: 'relationship_created'; data: Relationship }
  | { event_type: 'relationship_deleted'; data: { id: string; source_node_id: string; destination_node_id: string } }
  | { event_type: 'relationship_updated'; data: Relationship }
  | { event_type: 'activity_logged'; data: { activity_type: string; details: string; created_at: string } };

export interface ImportDraft {
  id: string;
  name: string;
  draft_json: {
    assets: any[];
    relationships: any[];
  };
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
