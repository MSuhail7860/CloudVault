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
