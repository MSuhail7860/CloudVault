import { api } from "./api";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface FileSearchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FileSearchResponse {
  data: CloudFile[];
  pagination: FileSearchPagination;
}

export interface FileListOptions {
  page?: number;
  limit?: number;
  sortBy?: "name" | "size" | "createdAt" | "updatedAt" | "mimeType";
  sortOrder?: "asc" | "desc";
  mimeType?: string;
}

export interface FolderListOptions {
  page?: number;
  limit?: number;
  sortBy?: "name" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: FileSearchPagination;
}

export interface DashboardStats {
  files: {
    total: number;
    storageBytes: string;
  };
  trash: {
    total: number;
    storageBytes: string;
  };
  fileTypes: {
    mimeType: string;
    count: number;
  }[];
  recentFiles: CloudFile[];
}

export interface CloudFile {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersion {
  id: string;
  version: number;
  mimeType: string;
  size: string;
  createdAt: string;
}

export interface UploadedFileVersion {
  version: FileVersion;
  file: CloudFile;
}

export interface RestoredFileVersion {
  savedCurrentVersion: FileVersion;
  file: CloudFile;
}

export interface TrashedCloudFile {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: string;
  folderId: string | null;
  createdAt: string;
  deletedAt: string;
}

export interface CloudFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await api.get<ApiResponse<DashboardStats>>("/dashboard");

  return response.data.data;
}

export async function listFiles(
  folderId?: string | null,
): Promise<CloudFile[]> {
  const items: CloudFile[] = [];
  let page = 1;

  while (true) {
    const result = await listFilesPage(folderId, { page, limit: 100 });
    items.push(...result.items);
    if (page >= result.pagination.totalPages) break;
    page += 1;
  }

  return items;
}

export async function listFilesPage(
  folderId?: string | null,
  options: FileListOptions = {},
): Promise<PaginatedResponse<CloudFile>> {
  const response = await api.get<
    ApiResponse<CloudFile[]> & { pagination: FileSearchPagination }
  >("/files", {
    params: {
      folderId: folderId || undefined,
      ...options,
    },
  });

  return {
    items: response.data.data,
    pagination: response.data.pagination,
  };
}

// File search API

export async function searchCloudFiles(
  query: string,
  page = 1,
  limit = 10,
  options: Omit<FileListOptions, "page" | "limit"> = {},
): Promise<FileSearchResponse> {
  const response = await api.get<
    ApiResponse<CloudFile[]> & {
      pagination: FileSearchPagination;
    }
  >("/files/search", {
    params: {
      q: query,
      page,
      limit,
      ...options,
    },
  });

  return {
    data: response.data.data,
    pagination: response.data.pagination,
  };
}

export async function listFolders(
  parentId?: string | null,
): Promise<CloudFolder[]> {
  const items: CloudFolder[] = [];
  let page = 1;

  while (true) {
    const result = await listFoldersPage(parentId, { page, limit: 100 });
    items.push(...result.items);
    if (page >= result.pagination.totalPages) break;
    page += 1;
  }

  return items;
}

export async function listFoldersPage(
  parentId?: string | null,
  options: FolderListOptions = {},
): Promise<PaginatedResponse<CloudFolder>> {
  const response = await api.get<
    ApiResponse<CloudFolder[]> & { pagination: FileSearchPagination }
  >("/folders", {
    params: {
      parentId: parentId || undefined,
      ...options,
    },
  });

  return {
    items: response.data.data,
    pagination: response.data.pagination,
  };
}

export async function uploadFile(
  file: File,
  folderId?: string | null,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<CloudFile> {
  const formData = new FormData();
  formData.append("file", file);

  if (folderId) {
    formData.append("folderId", folderId);
  }

  const response = await api.post<ApiResponse<CloudFile>>(
    "/files/upload",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      onUploadProgress: (event) => {
        if (event.total) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      },
      signal,
    },
  );

  return response.data.data;
}

export async function createFolder(
  name: string,
  parentId?: string | null,
): Promise<CloudFolder> {
  const response = await api.post<ApiResponse<CloudFolder>>("/folders", {
    name,
    parentId: parentId ?? null,
  });

  return response.data.data;
}

export async function renameCloudFile(
  fileId: string,
  name: string,
): Promise<CloudFile> {
  const response = await api.patch<ApiResponse<CloudFile>>(
    `/files/${encodeURIComponent(fileId)}/rename`,
    { name },
  );

  return response.data.data;
}

export async function moveCloudFile(
  fileId: string,
  folderId: string | null,
): Promise<CloudFile> {
  const response = await api.patch<ApiResponse<CloudFile>>(
    `/files/${encodeURIComponent(fileId)}/move`,
    { folderId },
  );

  return response.data.data;
}

// File versioning APIs

export async function listFileVersions(
  fileId: string,
): Promise<FileVersion[]> {
  const response = await api.get<ApiResponse<FileVersion[]>>(
    `/files/${encodeURIComponent(fileId)}/versions`,
  );

  return response.data.data;
}

export async function uploadFileVersion(
  fileId: string,
  file: File,
): Promise<UploadedFileVersion> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post<ApiResponse<UploadedFileVersion>>(
    `/files/${encodeURIComponent(fileId)}/versions`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );

  return response.data.data;
}

export async function restoreFileVersion(
  fileId: string,
  versionId: string,
): Promise<RestoredFileVersion> {
  const response = await api.post<ApiResponse<RestoredFileVersion>>(
    `/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restore`,
  );

  return response.data.data;
}

export async function downloadFileVersion(
  fileId: string,
  versionId: string,
): Promise<Blob> {
  const response = await api.get(
    `/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/download`,
    { responseType: "blob" },
  );

  return response.data as Blob;
}

export async function moveFileToTrash(fileId: string): Promise<void> {
  await api.delete(`/files/${encodeURIComponent(fileId)}`);
}

export async function downloadCloudFile(fileId: string): Promise<Blob> {
  const response = await api.get(
    `/files/${encodeURIComponent(fileId)}/download`,
    { responseType: "blob" },
  );

  return response.data as Blob;
}

export async function deleteCloudFolder(folderId: string): Promise<void> {
  await api.delete(`/folders/${encodeURIComponent(folderId)}`);
}

export async function renameCloudFolder(
  folderId: string,
  name: string,
): Promise<CloudFolder> {
  const response = await api.patch<ApiResponse<CloudFolder>>(
    `/folders/${encodeURIComponent(folderId)}/rename`,
    { name },
  );

  return response.data.data;
}

export async function moveCloudFolder(
  folderId: string,
  parentId: string | null,
): Promise<CloudFolder> {
  const response = await api.patch<ApiResponse<CloudFolder>>(
    `/folders/${encodeURIComponent(folderId)}/move`,
    { parentId },
  );

  return response.data.data;
}

export async function listTrashedFiles(): Promise<TrashedCloudFile[]> {
  const response = await api.get<ApiResponse<TrashedCloudFile[]>>(
    "/files/trash",
  );

  return response.data.data;
}

export async function restoreTrashedFile(
  fileId: string,
): Promise<CloudFile> {
  const response = await api.post<ApiResponse<CloudFile>>(
    `/files/${encodeURIComponent(fileId)}/restore`,
  );

  return response.data.data;
}

export async function permanentlyDeleteTrashedFile(
  fileId: string,
): Promise<void> {
  await api.delete(`/files/${encodeURIComponent(fileId)}/permanent`);
}

export async function previewCloudFile(fileId: string): Promise<Blob> {
  const response = await api.get(
    `/files/${encodeURIComponent(fileId)}/download`,
    {
      responseType: "blob",
    },
  );

  return response.data as Blob;
}

export interface ShareLink {
  id: string;
  fileId: string;
  permission?: "VIEW" | "EDIT";
  sharedWithEmail?: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ShareCreatedByMeItem extends ShareLink {
  file: {
    id: string;
    name: string;
    originalName: string;
    mimeType: string;
    size: string;
  };
  sharedWith?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

export interface SharedWithMeItem {
  id: string;
  fileId: string;
  permission: "VIEW" | "EDIT";
  expiresAt: string | null;
  createdAt: string;
  file: {
    id: string;
    name: string;
    originalName: string;
    mimeType: string;
    size: string;
    owner: {
      id: string;
      name: string | null;
      email: string;
    };
  };
}

export interface CreatedShareLink {
  id: string;
  fileId: string;
  token: string;
  permission?: "VIEW" | "EDIT";
  sharedWithEmail?: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  resourceType: "FILE" | "FOLDER" | "SHARE";
  resourceId: string | null;
  resourceName: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

export interface ActivityPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function createShareLink(
  fileId: string,
  expiresAt?: string | null,
  permission: "VIEW" | "EDIT" = "VIEW",
  sharedWithEmail?: string | null,
): Promise<CreatedShareLink> {
  const response = await api.post<ApiResponse<CreatedShareLink>>(
    `/shares/files/${encodeURIComponent(fileId)}`,
    {
      expiresAt: expiresAt ?? null,
      permission,
      sharedWithEmail: sharedWithEmail ?? null,
    },
  );

  return response.data.data;
}

export async function listShareLinks(
  fileId: string,
): Promise<ShareLink[]> {
  const response = await api.get<ApiResponse<ShareLink[]>>(
    `/shares/files/${encodeURIComponent(fileId)}`,
  );

  return response.data.data;
}

export async function listSharesCreatedByMe(): Promise<ShareCreatedByMeItem[]> {
  const response = await api.get<ApiResponse<ShareCreatedByMeItem[]>>(
    "/shares/created-by-me",
  );

  return response.data.data;
}

export async function listSharesWithMe(): Promise<SharedWithMeItem[]> {
  const response = await api.get<ApiResponse<SharedWithMeItem[]>>(
    "/shares/with-me",
  );

  return response.data.data;
}

export async function updateSharePermission(
  shareLinkId: string,
  permission?: "VIEW" | "EDIT",
  expiresAt?: string | null,
): Promise<ShareLink> {
  const response = await api.patch<ApiResponse<ShareLink>>(
    `/shares/${encodeURIComponent(shareLinkId)}`,
    { permission, expiresAt },
  );

  return response.data.data;
}

export async function revokeShareLink(
  shareLinkId: string,
): Promise<void> {
  await api.delete(`/shares/${encodeURIComponent(shareLinkId)}`);
}

export async function downloadSharedFileForUser(shareId: string): Promise<Blob> {
  const response = await api.get(
    `/shares/with-me/${encodeURIComponent(shareId)}/download`,
    { responseType: "blob" },
  );

  return response.data as Blob;
}

export async function listActivities(
  page = 1,
  limit = 10,
): Promise<{ data: ActivityItem[]; pagination: ActivityPagination }> {
  const response = await api.get<
    ApiResponse<ActivityItem[]> & { pagination: ActivityPagination }
  >("/activities", {
    params: { page, limit },
  });

  return {
    data: response.data.data,
    pagination: response.data.pagination,
  };
}
