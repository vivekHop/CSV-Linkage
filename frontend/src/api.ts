import type { Asset, Column, Relationship, VersionHistory, ActivityLog, SearchResponse } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';

// API Client Wrapper
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody?.detail || `API request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Assets
  getAssets: () => request<Asset[]>('/assets'),
  
  getAsset: (id: string) => request<Asset>(`/assets/${id}`),

  createAsset: (asset: Omit<Asset, 'id' | 'created_at' | 'updated_at' | 'columns'> & { columns: any[] }) =>
    request<Asset>('/assets', {
      method: 'POST',
      body: JSON.stringify(asset),
    }),
  
  uploadAssets: async (files: FileList | File[]): Promise<Asset[]> => {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    
    const res = await fetch(`${API_URL}/assets/upload`, {
      method: 'POST',
      body: formData,
      // Do NOT set Content-Type header; browser automatically sets multipart/form-data boundary
    });
    
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody?.detail || 'Upload failed');
    }
    
    return res.json();
  },
  
  updateAsset: (id: string, updates: Partial<Asset>) =>
    request<Asset>(`/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
    
  deleteAsset: (id: string) =>
    request<{ status: string; message: string }>(`/assets/${id}`, {
      method: 'DELETE',
    }),
    
  getAssetHistory: (id: string) => request<VersionHistory[]>(`/assets/${id}/history`),

  // Columns
  getColumn: (id: string) => request<Column>(`/columns/${id}`),
  
  updateColumn: (id: string, updates: Partial<Column>) =>
    request<Column>(`/columns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  // Relationships (Lineage)
  getRelationships: () => request<Relationship[]>('/relationships'),
  
  createRelationship: (relationship: Omit<Relationship, 'id' | 'created_at' | 'updated_at'>) =>
    request<Relationship>('/relationships', {
      method: 'POST',
      body: JSON.stringify(relationship),
    }),
    
  updateRelationship: (id: string, updates: Partial<Relationship>) =>
    request<Relationship>(`/relationships/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
    
  deleteRelationship: (id: string) =>
    request<{ status: string; message: string }>(`/relationships/${id}`, {
      method: 'DELETE',
    }),

  // Activities
  getActivities: (limit = 50) => request<ActivityLog[]>(`/activities?limit=${limit}`),

  // Search
  search: (query: string) => request<SearchResponse>(`/search?q=${encodeURIComponent(query)}`),

  // Workspace Sync
  syncWorkspace: (payload: { assets: any[]; relationships: any[] }) =>
    request<{ status: string; message: string }>('/assets/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
