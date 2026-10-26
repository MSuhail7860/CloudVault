import { api } from "./api";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
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

export async function listFiles(folderId?: string | null): Promise<CloudFile[]> {
  const response = await api.get<ApiResponse<CloudFile[]>>("/files", {
    params: { folderId: folderId || undefined },
  });

  return response.data.data;
}

export async function listFolders(): Promise<CloudFolder[]> {
  const response =
    await api.get<ApiResponse<CloudFolder[]>>("/folders");

  return response.data.data;
}

export async function uploadFile(
  file: File,
  folderId?: string | null,
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
  await api.delete(
    `/files/${encodeURIComponent(fileId)}/permanent`,
  );
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
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedShareLink {
  id: string;
  fileId: string;
  token: string;
  expiresAt: string | null;
  createdAt: string;
}

export async function createShareLink(
  fileId: string,
  expiresAt?: string | null,
): Promise<CreatedShareLink> {
  const response = await api.post<ApiResponse<CreatedShareLink>>(
    `/shares/files/${encodeURIComponent(fileId)}`,
    { expiresAt: expiresAt ?? null },
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

export async function revokeShareLink(
  shareLinkId: string,
): Promise<void> {
  await api.delete(`/shares/${encodeURIComponent(shareLinkId)}`);
}
