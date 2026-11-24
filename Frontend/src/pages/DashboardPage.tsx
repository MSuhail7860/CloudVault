import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ChangeEvent, DragEvent } from "react";
import axios from "axios";
import { useNavigate, useOutletContext } from "react-router-dom";
import { logoutUser } from "../lib/auth";
import type { ProtectedRouteContext } from "../components/ProtectedRoute";
import TextPreview from "./TextPreview";
import {
  listFiles,
  listFilesPage,
  searchCloudFiles,
  getDashboardStats,
  listFolders,
  uploadFile,
  downloadCloudFile,
  createFolder as createCloudFolder,
  renameCloudFile,
  moveCloudFile,
  renameCloudFolder,
  moveCloudFolder,
  moveFileToTrash,
  deleteCloudFolder,
  listTrashedFiles,
  restoreTrashedFile,
  permanentlyDeleteTrashedFile,
  listFileVersions,
  uploadFileVersion,
  restoreFileVersion,
  downloadFileVersion,
  type CloudFile,
  type CloudFolder,
  type TrashedCloudFile,
  type FileVersion,
  createShareLink,
  listSharesCreatedByMe,
  listSharesWithMe,
  updateSharePermission,
  downloadSharedFileForUser,
  revokeShareLink,
  listActivities,
  type ShareLink,
  type ShareCreatedByMeItem,
  type SharedWithMeItem,
  type ActivityItem,
  type DashboardStats,
  type FileSearchPagination,
} from "../lib/files";

import type { LucideIcon } from "lucide-react";

import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Copy,
  ChevronDown,
  Clock3,
  Cloud,
  Download,
  File,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  History,
  Home,
  Link2,
  Menu,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Trash,
  Trash2,
  Upload,
  Users,
  X,
  Eye,
} from "lucide-react";

type FileItem = {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  modified: string;
  modifiedAt: string;
  createdAt: string;
  sizeBytes: number;
  size: string;
  icon: LucideIcon;
  color: string;
  bg: string;
};

type PreviewItem = {
  name: string;
  mimeType: string;
  url: string;
  blob: Blob;
};

type UploadItem = {
  id: string;
  file: File;
  folderId: string | null;
  progress: number;
  status: "queued" | "uploading" | "complete" | "failed" | "cancelled";
  error?: string;
};

const navigation: { label: string; icon: LucideIcon }[] = [
  { label: "Dashboard", icon: Home },
  { label: "My Files", icon: Folder },
  { label: "Shared With Me", icon: Users },
  { label: "Shared Links", icon: Link2 },
  { label: "Trash", icon: Trash2 },
  { label: "Versions", icon: History },
  { label: "Settings", icon: Settings },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSize(value: string | number | null | undefined): string {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getShareExpiry(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function getFilePresentation(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return {
      type: "Image",
      icon: FileImage,
      color: "text-teal-600",
      bg: "bg-teal-50",
    };
  }

  if (mimeType === "application/pdf") {
    return {
      type: "PDF Document",
      icon: FileText,
      color: "text-red-500",
      bg: "bg-red-50",
    };
  }

  return {
    type: "File",
    icon: File,
    color: "text-blue-600",
    bg: "bg-blue-50",
  };
}

function getActivityPresentation(action: string) {
  switch (action) {
    case "FILE_UPLOADED":
      return { icon: Upload, color: "text-emerald-600", bg: "bg-emerald-50" };
    case "FILE_DOWNLOADED":
      return { icon: Download, color: "text-blue-600", bg: "bg-blue-50" };
    case "FILE_RENAMED":
    case "FOLDER_RENAMED":
    case "SHARE_PERMISSION_UPDATED":
      return { icon: Pencil, color: "text-amber-600", bg: "bg-amber-50" };
    case "FILE_MOVED":
      return { icon: ArrowRight, color: "text-indigo-600", bg: "bg-indigo-50" };
    case "FILE_DELETED":
    case "FOLDER_DELETED":
    case "SHARE_REVOKED":
    case "FILE_PERMANENTLY_DELETED":
      return { icon: Trash2, color: "text-rose-600", bg: "bg-rose-50" };
    case "FILE_RESTORED":
      return { icon: RotateCcw, color: "text-teal-600", bg: "bg-teal-50" };
    case "FOLDER_CREATED":
      return { icon: FolderPlus, color: "text-violet-600", bg: "bg-violet-50" };
    case "FILE_SHARED":
      return { icon: Share2, color: "text-sky-600", bg: "bg-sky-50" };
    case "FILE_VERSION_CREATED":
      return { icon: History, color: "text-indigo-600", bg: "bg-indigo-50" };
    default:
      return { icon: File, color: "text-slate-600", bg: "bg-slate-50" };
  }
}

function getActivityTitle(act: ActivityItem): string {
  switch (act.action) {
    case "FILE_UPLOADED":
      return `Uploaded "${act.resourceName}"`;
    case "FILE_DOWNLOADED":
      return `Downloaded "${act.resourceName}"`;
    case "FILE_RENAMED":
      return `Renamed to "${act.resourceName}"`;
    case "FILE_MOVED":
      return `Moved "${act.resourceName}"`;
    case "FILE_DELETED":
      return `Moved "${act.resourceName}" to trash`;
    case "FILE_RESTORED":
      return `Restored "${act.resourceName}"`;
    case "FILE_PERMANENTLY_DELETED":
      return `Permanently deleted "${act.resourceName}"`;
    case "FOLDER_CREATED":
      return `Created folder "${act.resourceName}"`;
    case "FOLDER_RENAMED":
      return `Renamed folder to "${act.resourceName}"`;
    case "FOLDER_MOVED":
      return `Moved folder "${act.resourceName}"`;
    case "FOLDER_DELETED":
      return `Deleted folder "${act.resourceName}"`;
    case "FILE_SHARED":
      return `Shared "${act.resourceName}"`;
    case "SHARE_PERMISSION_UPDATED":
      return `Updated share permission for "${act.resourceName}"`;
    case "SHARE_REVOKED":
      return `Revoked link for "${act.resourceName}"`;
    case "FILE_VERSION_CREATED":
      return `Created version of "${act.resourceName}"`;
    default:
      return `Updated "${act.resourceName}"`;
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [activePage, setActivePage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filePagination, setFilePagination] = useState<FileSearchPagination>({
    page: 1,
    limit: 100,
    total: 0,
    totalPages: 0,
  });
  const [sortBy, setSortBy] = useState<"name" | "size" | "createdAt" | "updatedAt" | "mimeType">("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [mimeTypeFilter, setMimeTypeFilter] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<CloudFolder[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [moveDialogFile, setMoveDialogFile] = useState<FileItem | null>(null);
  const [moveFolders, setMoveFolders] = useState<CloudFolder[]>([]);
  const [moveDestinationId, setMoveDestinationId] = useState<string>("");
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const { user } = useOutletContext<ProtectedRouteContext>();
  const [loading, setLoading] = useState(true);
  const [fileError, setFileError] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [uploadBatchActive, setUploadBatchActive] = useState(false);
  const uploadBatchActiveRef = useRef(false);
  const uploadControllers = useRef(new Map<string, AbortController>());
  const cancelledUploadIds = useRef(new Set<string>());
  const [dragActive, setDragActive] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [dashboardStatsError, setDashboardStatsError] = useState("");
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchResultsQuery, setSearchResultsQuery] = useState("");
  const [searchPagination, setSearchPagination] = useState<FileSearchPagination>({
    page: 1,
    limit: 100,
    total: 0,
    totalPages: 0,
  });
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [trashedFiles, setTrashedFiles] = useState<TrashedCloudFile[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState("");

  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [versionDialogFile, setVersionDialogFile] = useState<FileItem | null>(null);
  const [fileVersions, setFileVersions] = useState<FileVersion[]>([]);
  const [allFileVersions, setAllFileVersions] = useState<{ file: FileItem; version: FileVersion }[]>([]);
  const [allVersionsLoading, setAllVersionsLoading] = useState(false);
  const [allVersionsError, setAllVersionsError] = useState("");
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const [versionUploading, setVersionUploading] = useState(false);
  const [versionRestoringId, setVersionRestoringId] = useState<string | null>(null);
  const versionUploadRef = useRef<HTMLInputElement>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const [shareLinks, setShareLinks] = useState<(ShareLink & { fileName: string })[]>([]);
  const [shareCreatedList, setShareCreatedList] = useState<ShareCreatedByMeItem[]>([]);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [shareLinksError, setShareLinksError] = useState("");
  const [shareDialogFile, setShareDialogFile] = useState<FileItem | null>(null);
  const [shareExpiry, setShareExpiry] = useState("never");
  const [sharePermission, setSharePermission] = useState<"VIEW" | "EDIT">("VIEW");
  const [shareRecipientEmail, setShareRecipientEmail] = useState("");
  const [createdShareUrl, setCreatedShareUrl] = useState("");
  const [shareSubmitting, setShareSubmitting] = useState(false);

  const [editingShareLink, setEditingShareLink] = useState<ShareCreatedByMeItem | null>(null);
  const [editPermission, setEditPermission] = useState<"VIEW" | "EDIT">("VIEW");
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [sharedWithMeList, setSharedWithMeList] = useState<SharedWithMeItem[]>([]);
  const [sharedWithMeLoading, setSharedWithMeLoading] = useState(false);
  const [sharedWithMeError, setSharedWithMeError] = useState("");

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState("");

  function notify(message: string) {
    setNotice(message);

    if (noticeTimer.current !== undefined) {
      window.clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      noticeTimer.current = undefined;
    }, 3500);
  }

  const refreshCloudFiles = useCallback(async (
    folderId: string | null = currentFolderId,
    page = 1,
    append = false,
    options: {
      sortBy?: typeof sortBy;
      sortOrder?: typeof sortOrder;
      mimeType?: string;
    } = {},
  ) => {
    setFileError("");
    setLoading(true);

    try {
      const [fileResult, cloudFolders] = await Promise.all([
        listFilesPage(folderId, {
          page,
          limit: 100,
          sortBy: options.sortBy ?? sortBy,
          sortOrder: options.sortOrder ?? sortOrder,
          mimeType: (options.mimeType ?? mimeTypeFilter) || undefined,
        }),
        listFolders(folderId),
      ]);

      const mapFile = (file: CloudFile): FileItem => {
        const mimeType = file.mimeType || "application/octet-stream";
        const presentation = getFilePresentation(mimeType);

        return {
          id: file.id,
          name: file.name || file.originalName,
          type: presentation.type,
          mimeType,
          modified: formatDate(file.updatedAt || file.createdAt),
          modifiedAt: file.updatedAt || file.createdAt,
          createdAt: file.createdAt,
          sizeBytes: Number(file.size),
          size: formatSize(file.size),
          icon: presentation.icon,
          color: presentation.color,
          bg: presentation.bg,
        };
      };

      const mapFolder = (folder: CloudFolder): FileItem => ({
        id: folder.id,
        name: folder.name,
        type: "Folder",
        mimeType: "",
        modified: formatDate(folder.updatedAt || folder.createdAt),
        modifiedAt: folder.updatedAt || folder.createdAt,
        createdAt: folder.createdAt,
        sizeBytes: 0,
        size: "—",
        icon: Folder,
        color: "text-blue-600",
        bg: "bg-blue-50",
      });

      const nextFiles = [
        ...cloudFolders.map(mapFolder),
        ...fileResult.items.map(mapFile),
      ];
      setFiles((current) => {
        if (!append) return nextFiles;
        const merged = new Map(current.map((file) => [file.id, file]));
        nextFiles.forEach((file) => merged.set(file.id, file));
        return [...merged.values()];
      });
      setFilePagination(fileResult.pagination);
    } catch (error) {
      console.error("Failed to load CloudVault files:", error);
      setFileError(
        "Couldn't load files. Check that the backend is running and you're signed in.",
      );
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, mimeTypeFilter, sortBy, sortOrder]);

  async function refreshDashboardStats() {
    setDashboardStatsError("");
    try {
      setDashboardStats(await getDashboardStats());
    } catch (error) {
      console.error("Failed to load dashboard statistics:", error);
      setDashboardStatsError("Dashboard statistics are temporarily unavailable.");
    }
  }

  async function loadMoveFolders(parentId: string | null = null): Promise<CloudFolder[]> {
    const folders = await listFolders(parentId);

    const nestedFolders = await Promise.all(
      folders.map((folder) => loadMoveFolders(folder.id)),
    );

    return folders.flatMap((folder, index) => [
      folder,
      ...nestedFolders[index],
    ]);
  }

  async function loadAllFileVersions() {
    setAllVersionsLoading(true);
    setAllVersionsError("");

    try {
      const folders = await loadMoveFolders();

      const filesByFolder = await Promise.all([
        listFiles(null),
        ...folders.map((folder) => listFiles(folder.id)),
      ]);

      const cloudFiles = filesByFolder.flat();

      const mapFile = (file: CloudFile): FileItem => {
        const mimeType = file.mimeType || "application/octet-stream";
        const presentation = getFilePresentation(mimeType);

        return {
          id: file.id,
          name: file.name || file.originalName,
          type: presentation.type,
          mimeType,
          modified: formatDate(file.updatedAt || file.createdAt),
          modifiedAt: file.updatedAt || file.createdAt,
          createdAt: file.createdAt,
          sizeBytes: Number(file.size),
          size: formatSize(file.size),
          icon: presentation.icon,
          color: presentation.color,
          bg: presentation.bg,
        };
      };

      const versionResults = await Promise.all(
        cloudFiles.map(async (cloudFile) => {
          const file = mapFile(cloudFile);
          const versions = await listFileVersions(file.id);

          return versions.map((version) => ({ file, version }));
        }),
      );

      const allVersions = versionResults.flat();

      allVersions.sort(
        (a, b) =>
          new Date(b.version.createdAt).getTime() -
          new Date(a.version.createdAt).getTime(),
      );

      setAllFileVersions(allVersions);
    } catch (error) {
      console.error("Failed to load all file versions:", error);
      setAllVersionsError("Unable to load file versions. Please try again.");
    } finally {
      setAllVersionsLoading(false);
    }
  }

  async function handleOpenMoveDialog(file: FileItem) {
    setOpenMenuId(null);
    setMoveDialogFile(file);
    setMoveDestinationId(currentFolderId ?? "");
    setMoveLoading(true);

    try {
      const folders = await loadMoveFolders();
      if (file.type === "Folder") {
        const descendants = new Set<string>([file.id]);
        let addedDescendant = true;

        while (addedDescendant) {
          addedDescendant = false;
          for (const folder of folders) {
            if (
              folder.parentId &&
              descendants.has(folder.parentId) &&
              !descendants.has(folder.id)
            ) {
              descendants.add(folder.id);
              addedDescendant = true;
            }
          }
        }

        setMoveFolders(folders.filter((folder) => !descendants.has(folder.id)));
      } else {
        setMoveFolders(folders);
      }
    } catch (error) {
      console.error("Failed to load folders for moving:", error);
      notify("Couldn't load folders. Please try again.");
      setMoveDialogFile(null);
    } finally {
      setMoveLoading(false);
    }
  }

  async function handleMoveFile() {
    if (!moveDialogFile) return;

    setMoveSubmitting(true);

    try {
      if (moveDialogFile.type === "Folder") {
        await moveCloudFolder(
          moveDialogFile.id,
          moveDestinationId || null,
        );
      } else {
        await moveCloudFile(
          moveDialogFile.id,
          moveDestinationId || null,
        );
      }

      const movedItemName = moveDialogFile.name;
      setMoveDialogFile(null);
      await refreshCloudFiles();

      notify(`"${movedItemName}" moved successfully.`);
    } catch (error) {
      console.error("Failed to move item:", error);
      notify(`Couldn't move "${moveDialogFile.name}". Please try again.`);
    } finally {
      setMoveSubmitting(false);
    }
  }

  function openFolder(folder: FileItem) {
    if (folder.type !== "Folder") return;

    const folderInfo: CloudFolder = {
      id: folder.id,
      name: folder.name,
      parentId: currentFolderId,
      createdAt: folder.modified,
      updatedAt: folder.modified,
    };

    setCurrentFolderId(folder.id);
    setFolderPath((path) => [...path, folderInfo]);
    setSelectedFileIds(new Set());
    setOpenMenuId(null);
    setSearch("");
  }

  function navigateToFolder(index: number) {
    const nextPath = index < 0 ? [] : folderPath.slice(0, index + 1);
    const folderId = index < 0 ? null : nextPath[index]?.id ?? null;

    setFolderPath(nextPath);
    setCurrentFolderId(folderId);
    setSelectedFileIds(new Set());
    setOpenMenuId(null);
    setSearch("");
  }

  async function refreshTrash() {
    setTrashLoading(true);
    setTrashError("");

    try {
      const result = await listTrashedFiles();
      setTrashedFiles(result);
    } catch (error) {
      console.error("Failed to load trash:", error);
      setTrashError("Unable to load your trash. Please try again.");
    } finally {
      setTrashLoading(false);
    }
  }

  async function handleDownload(fileId: string, fileName: string) {
    setOpenMenuId(null);

    try {
      const blob = await downloadCloudFile(fileId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`Download started: ${fileName}`);
    } catch (error) {
      console.error(`Failed to download ${fileName}:`, error);
      notify(`Couldn't download ${fileName}. Please try again.`);
    }
  }

  async function handlePreview(file: FileItem) {
    setOpenMenuId(null);

    const isImage = file.mimeType.startsWith("image/");
    const isPdf = file.mimeType === "application/pdf";
    const isText =
      file.mimeType.startsWith("text/") ||
      [
        "application/json",
        "application/xml",
        "application/javascript",
        "application/x-yaml",
        "application/yaml",
        "application/markdown",
      ].includes(file.mimeType);

    if (!isImage && !isPdf && !isText) {
      notify(
        "Preview is available for images, PDFs, and text files only."
      );
      return;
    }

    if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
      notify("This file is empty and cannot be previewed.");
      return;
    }

    if (file.sizeBytes > 10 * 1024 * 1024) {
      notify("This file is too large to preview. Download it to view its contents.");
      return;
    }

    if (isText && file.sizeBytes > 1024 * 1024) {
      notify("Text previews are limited to 1 MB. Download this file to view it.");
      return;
    }

    setPreviewLoadingId(file.id);

    try {
      const blob = await downloadCloudFile(file.id);
      if (blob.size > 10 * 1024 * 1024 || (isText && blob.size > 1024 * 1024)) {
        notify("This file is too large to preview. Download it to view its contents.");
        return;
      }
      const url = URL.createObjectURL(blob);

      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);

        return {
          name: file.name,
          mimeType: file.mimeType,
          url,
          blob,
        };
      });
    } catch (error) {
      console.error(`Failed to preview ${file.name}:`, error);
      notify(`Couldn't preview ${file.name}. Please try again.`);
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleOpenVersions(file: FileItem) {
    setOpenMenuId(null);
    setVersionDialogFile(file);
    setFileVersions([]);
    setVersionsError("");
    setVersionsLoading(true);

    try {
      const versions = await listFileVersions(file.id);
      setFileVersions(versions);
    } catch (error) {
      console.error(`Failed to load versions for ${file.name}:`, error);
      setVersionsError("Unable to load version history. Please try again.");
    } finally {
      setVersionsLoading(false);
    }
  }

  async function handleUploadNewVersion(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile || !versionDialogFile) return;

    setVersionUploading(true);

    try {
      await uploadFileVersion(versionDialogFile.id, selectedFile);

      const fileName = versionDialogFile.name;

      event.target.value = "";
      await refreshCloudFiles();

      const versions = await listFileVersions(versionDialogFile.id);
      setFileVersions(versions);

      notify(`New version uploaded for "${fileName}".`);
    } catch (error) {
      console.error("Failed to upload new file version:", error);
      notify("Couldn't upload the new version. Please try again.");
    } finally {
      setVersionUploading(false);
    }
  }

  async function handleRestoreVersion(version: FileVersion) {
    if (!versionDialogFile) return;

    const confirmed = window.confirm(
      `Restore version ${version.version}? Your current file will be preserved in version history.`,
    );

    if (!confirmed) return;

    setVersionRestoringId(version.id);

    try {
      await restoreFileVersion(versionDialogFile.id, version.id);

      await refreshCloudFiles();

      const versions = await listFileVersions(versionDialogFile.id);
      setFileVersions(versions);

      notify(`Version ${version.version} restored successfully.`);
    } catch (error) {
      console.error("Failed to restore file version:", error);
      notify("Couldn't restore this version. Please try again.");
    } finally {
      setVersionRestoringId(null);
    }
  }

  async function handleRestoreFromVersionsPage(
    file: FileItem,
    version: FileVersion,
  ) {
    const confirmed = window.confirm(
      `Restore version ${version.version} of "${file.name}"? The current file will be preserved in version history.`,
    );

    if (!confirmed) return;

    setVersionRestoringId(version.id);

    try {
      await restoreFileVersion(file.id, version.id);
      await Promise.all([refreshCloudFiles(), loadAllFileVersions()]);
      notify(`Version ${version.version} of "${file.name}" restored successfully.`);
    } catch (error) {
      console.error(`Failed to restore version ${version.version} of ${file.name}:`, error);
      notify("Couldn't restore this version. Please try again.");
    } finally {
      setVersionRestoringId(null);
    }
  }

  function closePreview() {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function handleRename(fileId: string, currentName: string) {
    setOpenMenuId(null);

    const enteredName = window.prompt("Enter the new file name:", currentName);
    if (enteredName === null) return;

    const newName = enteredName.trim();

    if (!newName) {
      notify("File name cannot be empty.");
      return;
    }

    if (newName === currentName) return;

    try {
      await renameCloudFile(fileId, newName);
      await refreshCloudFiles();
      notify(`File renamed to "${newName}".`);
    } catch (error) {
      console.error(`Failed to rename ${currentName}:`, error);
      notify("Couldn't rename the file. Please try again.");
    }
  }
  
  async function handleRenameFolder(folderId: string, currentName: string) {
    setOpenMenuId(null);

    const enteredName = window.prompt("Enter the new folder name:", currentName);
    if (enteredName === null) return;

    const newName = enteredName.trim();

    if (!newName) {
      notify("Folder name cannot be empty.");
      return;
    }

    if (newName === currentName) return;

    try {
      await renameCloudFolder(folderId, newName);
      await refreshCloudFiles();
      notify(`Folder renamed to "${newName}".`);
    } catch (error) {
      console.error(`Failed to rename folder "${currentName}":`, error);
      notify("Couldn't rename the folder. Please try again.");
    }
  }

  async function refreshShareLinks() {
    setShareLinksLoading(true);
    setShareLinksError("");

    try {
      const list = await listSharesCreatedByMe();
      setShareCreatedList(list);
      setShareLinks(
        list.map((link) => ({
          ...link,
          fileName: link.file.name || link.file.originalName,
        })),
      );
    } catch (error) {
      console.error("Failed to load share links:", error);
      setShareLinksError("Couldn't load share links. Please try again.");
    } finally {
      setShareLinksLoading(false);
    }
  }

  async function refreshSharedWithMe() {
    setSharedWithMeLoading(true);
    setSharedWithMeError("");

    try {
      const list = await listSharesWithMe();
      setSharedWithMeList(list);
    } catch (error) {
      console.error("Failed to load files shared with me:", error);
      setSharedWithMeError("Couldn't load shared files. Please try again.");
    } finally {
      setSharedWithMeLoading(false);
    }
  }

  async function loadRecentActivities() {
    setActivitiesLoading(true);
    setActivitiesError("");

    try {
      const res = await listActivities(1, 8);
      setActivities(res.data);
    } catch (error) {
      console.error("Failed to load activities:", error);
      setActivitiesError("Couldn't load recent activity.");
    } finally {
      setActivitiesLoading(false);
    }
  }

  async function handleCreateShareLink() {
    if (!shareDialogFile) return;

    setShareSubmitting(true);

    try {
      let expiresAt: string | null = null;

      if (shareExpiry !== "never") {
        const days = Number(shareExpiry);
        expiresAt = getShareExpiry(days);
      }

      const result = await createShareLink(
        shareDialogFile.id,
        expiresAt,
        sharePermission,
        shareRecipientEmail || null,
      );

      const apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL ??
        "http://localhost:8000/api/v1";

      const normalizedBaseUrl = apiBaseUrl.replace(/\/+$/, "");
      const shareUrl =
        `${normalizedBaseUrl}/shared/${encodeURIComponent(result.token)}`;

      setCreatedShareUrl(shareUrl);
      await refreshShareLinks();
      void loadRecentActivities();
      notify("Share link created successfully.");
    } catch (error) {
      console.error("Failed to create share link:", error);
      const msg = getErrorMessage(
        error,
        "Couldn't create the share link. Please try again.",
      );
      notify(msg);
    } finally {
      setShareSubmitting(false);
    }
  }

  async function handleUpdateSharePermission() {
    if (!editingShareLink) return;

    setEditSubmitting(true);

    try {
      await updateSharePermission(editingShareLink.id, editPermission);
      setEditingShareLink(null);
      await refreshShareLinks();
      void loadRecentActivities();
      notify("Share permission updated successfully.");
    } catch (error) {
      console.error("Failed to update share permission:", error);
      const msg = getErrorMessage(
        error,
        "Could not update share permission.",
      );
      notify(msg);
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDownloadSharedFileForUser(item: SharedWithMeItem) {
    try {
      const blob = await downloadSharedFileForUser(item.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.file.originalName || item.file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      void loadRecentActivities();
      notify(`Downloaded "${item.file.name}".`);
    } catch (error) {
      console.error("Failed to download shared file:", error);
      notify("Could not download this shared file. Please try again.");
    }
  }

  async function handlePreviewSharedFileForUser(item: SharedWithMeItem) {
    const mimeType = item.file.mimeType;
    const isText =
      mimeType.startsWith("text/") ||
      [
        "application/json",
        "application/xml",
        "application/javascript",
        "application/x-yaml",
        "application/yaml",
        "application/markdown",
      ].includes(mimeType);
    if (
      !mimeType.startsWith("image/") &&
      mimeType !== "application/pdf" &&
      !isText
    ) {
      notify("Preview is available for images, PDFs, and text files only.");
      return;
    }
    const size = Number(item.file.size);
    if (!Number.isFinite(size) || size <= 0) {
      notify("This file is empty and cannot be previewed.");
      return;
    }
    if (size > 10 * 1024 * 1024 || (isText && size > 1024 * 1024)) {
      notify("This file is too large to preview. Download it to view its contents.");
      return;
    }

    setPreviewLoadingId(item.id);
    try {
      const blob = await downloadSharedFileForUser(item.id);
      if (blob.size > 10 * 1024 * 1024 || (isText && blob.size > 1024 * 1024)) {
        notify("This file is too large to preview. Download it to view its contents.");
        return;
      }
      const url = URL.createObjectURL(blob);
      setPreview({
        name: item.file.name,
        mimeType,
        url,
        blob,
      });
    } catch (error) {
      console.error("Failed to preview shared file:", error);
      notify("Could not preview this shared file. Please try again.");
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleDownloadFileVersion(
    file: { id: string; name: string },
    version: FileVersion,
  ) {
    try {
      const blob = await downloadFileVersion(file.id, version.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name}-v${version.version}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      void loadRecentActivities();
      notify(`Downloaded version ${version.version} of "${file.name}".`);
    } catch (error) {
      console.error("Failed to download file version:", error);
      notify("Could not download this version. Please try again.");
    }
  }

  async function handleRevokeShareLink(linkId: string) {
    if (!window.confirm("Revoke this share link? Anyone using it will lose access.")) {
      return;
    }

    try {
      await revokeShareLink(linkId);
      await refreshShareLinks();
      void loadRecentActivities();
      notify("Share link revoked.");
    } catch (error) {
      console.error("Failed to revoke share link:", error);
      notify("Couldn't revoke the share link. Please try again.");
    }
  }

  async function handleCopyShareUrl() {
    if (!createdShareUrl) return;

    try {
      await navigator.clipboard.writeText(createdShareUrl);
      notify("Share link copied to clipboard.");
    } catch (error) {
      console.error("Failed to copy share link:", error);
      notify("Couldn't copy automatically. Select and copy the link manually.");
    }
  }

  async function handleDeleteFolder(folderId: string, folderName: string) {
    setOpenMenuId(null);

    if (
      !window.confirm(
        `Permanently delete the folder "${folderName}"? Only empty folders can be deleted. This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await deleteCloudFolder(folderId);
      await refreshCloudFiles();

      notify(`Folder "${folderName}" deleted successfully.`);
    } catch (error) {
      console.error(`Failed to delete folder "${folderName}":`, error);
      notify(
        `Couldn't delete "${folderName}". Make sure the folder contains no files or subfolders.`,
      );
    }
  }

  async function handleMoveToTrash(fileId: string, fileName: string) {
    setOpenMenuId(null);

    if (!window.confirm(`Move "${fileName}" to Trash?`)) return;

    try {
      await moveFileToTrash(fileId);
      setSelectedFileIds((current) => {
        const next = new Set(current);
        next.delete(fileId);
        return next;
      });
      await refreshCloudFiles();

      if (activePage === "Trash") await refreshTrash();

      notify(`Moved "${fileName}" to Trash.`);
    } catch (error) {
      console.error(`Failed to move ${fileName} to Trash:`, error);
      notify("Couldn't move the file to Trash. Please try again.");
    }
  }

  async function handleRestoreTrashedFile(file: TrashedCloudFile) {
    try {
      await restoreTrashedFile(file.id);
      setSelectedFileIds((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
      await Promise.all([refreshTrash(), refreshCloudFiles()]);
      notify(`"${file.name || file.originalName}" restored successfully.`);
    } catch (error) {
      console.error(`Failed to restore ${file.name}:`, error);
      notify("Could not restore this file. Please try again.");
    }
  }

  async function handlePermanentlyDeleteTrashedFile(
    file: TrashedCloudFile,
  ) {
    const fileName = file.name || file.originalName;

    if (
      !window.confirm(
        `Permanently delete "${fileName}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await permanentlyDeleteTrashedFile(file.id);
      setSelectedFileIds((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
      await refreshTrash();
      notify(`"${fileName}" permanently deleted.`);
    } catch (error) {
      console.error(`Failed to permanently delete ${fileName}:`, error);
      notify("Could not permanently delete this file. Please try again.");
    }
  }

  async function handleBulkFileAction(
    action: "trash" | "restore" | "permanently-delete",
  ) {
    const selectedIds = [...selectedFileIds];
    if (selectedIds.length === 0 || bulkActionLoading) return;

    if (
      action === "permanently-delete" &&
      !window.confirm(
        `Permanently delete ${selectedIds.length} selected file(s)? This cannot be undone.`,
      )
    ) {
      return;
    }

    if (
      action === "trash" &&
      !window.confirm(`Move ${selectedIds.length} selected file(s) to Trash?`)
    ) {
      return;
    }

    setBulkActionLoading(true);
    const completed = new Set<string>();

    try {
      for (const id of selectedIds) {
        try {
          if (action === "trash") {
            await moveFileToTrash(id);
          } else if (action === "restore") {
            await restoreTrashedFile(id);
          } else {
            await permanentlyDeleteTrashedFile(id);
          }
          completed.add(id);
        } catch (error) {
          console.error(`Bulk ${action} failed for file ${id}:`, error);
        }
      }

      setSelectedFileIds((current) =>
        new Set([...current].filter((id) => !completed.has(id))),
      );

      if (action === "trash") {
        await refreshCloudFiles();
      } else {
        await refreshTrash();
        if (action === "restore") await refreshCloudFiles();
      }

      const failedCount = selectedIds.length - completed.size;
      notify(
        failedCount
          ? `${completed.size} completed; ${failedCount} failed. Failed items remain selected.`
          : `${completed.size} file(s) ${action === "trash" ? "moved to Trash" : action === "restore" ? "restored" : "permanently deleted"}.`,
      );
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleRefresh() {
    if (activePage === "Trash") {
      await refreshTrash();
    } else if (activePage === "Shared Links") {
      await refreshShareLinks();
    } else if (activePage === "Shared With Me") {
      await refreshSharedWithMe();
    } else if (activePage === "Versions") {
      await loadAllFileVersions();
    } else {
      await Promise.all([
        refreshCloudFiles(),
        refreshDashboardStats(),
        loadRecentActivities(),
      ]);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshDashboardStats();
      void loadRecentActivities();
    }, 0);

    return () => {
      window.clearTimeout(initialLoad);
      if (noticeTimer.current !== undefined) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (search.trim()) return;
    const fileLoad = window.setTimeout(() => {
      void refreshCloudFiles();
    }, 0);
    return () => window.clearTimeout(fileLoad);
  }, [refreshCloudFiles, search]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const isTrashPage = activePage === "Trash";
  const isSharedLinksPage = activePage === "Shared Links";
  const isSharedWithMePage = activePage === "Shared With Me";
  const isVersionsPage = activePage === "Versions";

  useEffect(() => {
    const query = search.trim();
    if (
      !query ||
      isTrashPage ||
      isSharedLinksPage ||
      isSharedWithMePage ||
      isVersionsPage
    ) {
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      try {
        const result = await searchCloudFiles(query, 1, 100, {
          sortBy,
          sortOrder,
          mimeType: mimeTypeFilter || undefined,
        });
        const mapped: FileItem[] = result.data.map((file) => {
          const mimeType = file.mimeType || "application/octet-stream";
          const presentation = getFilePresentation(mimeType);
          return {
            id: file.id,
            name: file.name || file.originalName,
            type: presentation.type,
            mimeType,
            modified: formatDate(file.updatedAt || file.createdAt),
            modifiedAt: file.updatedAt || file.createdAt,
            createdAt: file.createdAt,
            sizeBytes: Number(file.size),
            size: formatSize(file.size),
            icon: presentation.icon,
            color: presentation.color,
            bg: presentation.bg,
          };
        });
        if (active) {
          setSearchResults(mapped);
          setSearchResultsQuery(query.toLowerCase());
          setSearchPagination(result.pagination);
        }
      } catch (error) {
        console.error("Failed to search files:", error);
        if (active) {
          setSearchResults([]);
          setSearchError("Couldn't search files. Please try again.");
        }
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [search, isTrashPage, isSharedLinksPage, isSharedWithMePage, isVersionsPage, sortBy, sortOrder, mimeTypeFilter]);

  const filteredSharedWithMe = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sharedWithMeList;
    return sharedWithMeList.filter((item) =>
      item.file.name.toLowerCase().includes(query),
    );
  }, [sharedWithMeList, search]);

  const filteredSharedLinks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return shareCreatedList;
    return shareCreatedList.filter(
      (link) =>
        (link.file.name || link.file.originalName)
          .toLowerCase()
          .includes(query) ||
        (link.sharedWithEmail &&
          link.sharedWithEmail.toLowerCase().includes(query)),
    );
  }, [shareCreatedList, search]);

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchingFolders = query
      ? files.filter(
          (file) =>
            file.type === "Folder" &&
            file.name.toLowerCase().includes(query),
        )
      : files.filter((file) => file.type === "Folder");
    const matchingFiles = query
      ? searchResultsQuery === query
        ? searchResults
        : []
      : files.filter((file) => file.type !== "Folder");
    const filtered = [...matchingFolders, ...matchingFiles].filter(
      (file) =>
        !mimeTypeFilter ||
        file.type === "Folder" ||
        (mimeTypeFilter.endsWith("/*")
          ? file.mimeType.startsWith(mimeTypeFilter.slice(0, -1))
          : file.mimeType === mimeTypeFilter),
    );
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: "base",
    });

    return filtered.sort((left, right) => {
      let comparison: number;
      if (sortBy === "name") {
        comparison = collator.compare(left.name, right.name);
      } else if (sortBy === "size") {
        comparison = left.sizeBytes - right.sizeBytes;
      } else if (sortBy === "mimeType") {
        comparison = collator.compare(left.mimeType, right.mimeType);
      } else if (sortBy === "createdAt") {
        comparison =
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime();
      } else {
        comparison =
          new Date(left.modifiedAt).getTime() -
          new Date(right.modifiedAt).getTime();
      }

      if (comparison === 0) comparison = left.id.localeCompare(right.id);
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [
    files,
    search,
    searchResults,
    searchResultsQuery,
    mimeTypeFilter,
    sortBy,
    sortOrder,
  ]);

  const filteredTrash = useMemo(
    () =>
      trashedFiles.filter((file) =>
        (file.name || file.originalName)
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [trashedFiles, search],
  );

  async function loadMoreFiles() {
    if (loading) return;
    const query = search.trim();
    if (query) {
      if (searchLoading || searchPagination.page >= searchPagination.totalPages) return;
      const nextPage = searchPagination.page + 1;
      setSearchLoading(true);
      setSearchError("");
      try {
        const result = await searchCloudFiles(query, nextPage, 100, {
          sortBy,
          sortOrder,
          mimeType: mimeTypeFilter || undefined,
        });
        const mapped = result.data.map((file): FileItem => {
          const mimeType = file.mimeType || "application/octet-stream";
          const presentation = getFilePresentation(mimeType);
          return {
            id: file.id,
            name: file.name || file.originalName,
            type: presentation.type,
            mimeType,
            modified: formatDate(file.updatedAt || file.createdAt),
            modifiedAt: file.updatedAt || file.createdAt,
            createdAt: file.createdAt,
            sizeBytes: Number(file.size),
            size: formatSize(file.size),
            icon: presentation.icon,
            color: presentation.color,
            bg: presentation.bg,
          };
        });
        setSearchResults((current) => {
          const merged = new Map(current.map((file) => [file.id, file]));
          mapped.forEach((file) => merged.set(file.id, file));
          return [...merged.values()];
        });
        setSearchResultsQuery(query.toLowerCase());
        setSearchPagination(result.pagination);
      } catch (error) {
        console.error("Failed to load more search results:", error);
        setSearchError("Couldn't load more files. Please try again.");
      } finally {
        setSearchLoading(false);
      }
      return;
    }

    if (filePagination.page < filePagination.totalPages) {
      await refreshCloudFiles(
        currentFolderId,
        filePagination.page + 1,
        true,
      );
    }
  }

  function changeSortBy(value: typeof sortBy) {
    setSortBy(value);
    setSelectedFileIds(new Set());
    setSearchResultsQuery("");
  }

  function changeSortOrder() {
    const nextOrder = sortOrder === "asc" ? "desc" : "asc";
    setSortOrder(nextOrder);
    setSelectedFileIds(new Set());
    setSearchResultsQuery("");
  }

  function changeMimeTypeFilter(value: string) {
    setMimeTypeFilter(value);
    setSelectedFileIds(new Set());
    setSearchResultsQuery("");
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setSearchResults([]);
    setSearchResultsQuery("");
    setSearchPagination({ page: 1, limit: 100, total: 0, totalPages: 0 });
    setSearchError("");
    setSearchLoading(Boolean(value.trim()));
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = folderName.trim();

    if (!name) {
      notify("Folder name cannot be empty.");
      return;
    }

    try {
      await createCloudFolder(name, currentFolderId);
      await refreshCloudFiles(currentFolderId);
      setFolderName("");
      setFolderDialog(false);
      notify(`Folder "${name}" created.`);
    } catch (error) {
      console.error("Failed to create folder:", error);
      notify("Couldn't create the folder. Please try again.");
    }
  }

  async function uploadSelectedFiles(selected: File[]) {
    if (selected.length === 0 || uploadBatchActiveRef.current) return;

    const targetFolderId = currentFolderId;
    const items = selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      folderId: targetFolderId,
      progress: 0,
      status: "queued" as const,
    }));
    setUploads(items);
    uploadBatchActiveRef.current = true;
    setUploadBatchActive(true);

    try {
      for (const item of items) {
        if (cancelledUploadIds.current.has(item.id)) {
          cancelledUploadIds.current.delete(item.id);
          continue;
        }
        if (
          item.file.size === 0 ||
          item.file.size > 10 * 1024 * 1024 ||
          item.file.type.length > 255
        ) {
          setUploads((current) => current.map((upload) =>
            upload.id === item.id
              ? {
                  ...upload,
                  status: "failed",
                  error: item.file.size === 0
                    ? "Empty files cannot be uploaded."
                    : item.file.size > 10 * 1024 * 1024
                      ? "File exceeds the 10 MB limit."
                      : "File type metadata is invalid.",
                }
              : upload,
          ));
          continue;
        }

        const controller = new AbortController();
        uploadControllers.current.set(item.id, controller);
        setUploads((current) => current.map((upload) =>
          upload.id === item.id ? { ...upload, status: "uploading" } : upload,
        ));

        try {
          await uploadFile(item.file, targetFolderId, (progress) => {
            setUploads((current) => current.map((upload) =>
              upload.id === item.id ? { ...upload, progress } : upload,
            ));
          }, controller.signal);
          setUploads((current) => current.map((upload) =>
            upload.id === item.id
              ? { ...upload, progress: 100, status: "complete" }
              : upload,
          ));
        } catch (error) {
          if (axios.isCancel(error)) {
            setUploads((current) => current.map((upload) =>
              upload.id === item.id
                ? { ...upload, status: "cancelled", error: undefined }
                : upload,
            ));
            notify(`Upload cancelled: ${item.file.name}`);
          } else {
            console.error(`Failed to upload ${item.file.name}:`, error);
            const message = axios.isAxiosError<{ message?: string }>(error)
              ? error.response?.data?.message ?? "Upload failed. Please retry."
              : error instanceof Error ? error.message : "Upload failed. Please retry.";
            setUploads((current) => current.map((upload) =>
              upload.id === item.id
                ? { ...upload, status: "failed", error: message }
                : upload,
            ));
          }
        } finally {
          uploadControllers.current.delete(item.id);
        }
      }
    } finally {
      uploadBatchActiveRef.current = false;
      setUploadBatchActive(false);
    }

    await refreshCloudFiles(targetFolderId);
    await refreshDashboardStats();
  }

  function cancelUpload(item: UploadItem) {
    if (item.status === "queued") {
      cancelledUploadIds.current.add(item.id);
      setUploads((current) => current.map((upload) =>
        upload.id === item.id ? { ...upload, status: "cancelled" } : upload,
      ));
      notify(`Upload cancelled: ${item.file.name}`);
      return;
    }

    uploadControllers.current.get(item.id)?.abort();
  }

  async function handleUploads(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selected = Array.from(input.files ?? []);
    input.value = "";
    await uploadSelectedFiles(selected);
  }

  async function retryUpload(item: UploadItem) {
    if (uploadBatchActiveRef.current || item.status !== "failed") return;
    if (item.file.size === 0) {
      notify("Empty files cannot be uploaded.");
      return;
    }
    if (item.file.size > 10 * 1024 * 1024) {
      notify("This file exceeds the 10 MB limit and cannot be retried.");
      return;
    }

    uploadBatchActiveRef.current = true;
    setUploadBatchActive(true);
    setUploads((current) => current.map((upload) =>
      upload.id === item.id
        ? { ...upload, progress: 0, status: "uploading", error: undefined }
        : upload,
    ));

    try {
      const controller = new AbortController();
      uploadControllers.current.set(item.id, controller);
      await uploadFile(item.file, item.folderId, (progress) => {
        setUploads((current) => current.map((upload) =>
          upload.id === item.id ? { ...upload, progress } : upload,
        ));
      }, controller.signal);
      setUploads((current) => current.map((upload) =>
        upload.id === item.id
          ? { ...upload, progress: 100, status: "complete", error: undefined }
          : upload,
      ));
    } catch (error) {
      if (axios.isCancel(error)) {
        setUploads((current) => current.map((upload) =>
          upload.id === item.id ? { ...upload, status: "cancelled" } : upload,
        ));
        notify(`Upload cancelled: ${item.file.name}`);
      } else {
        console.error(`Failed to retry upload ${item.file.name}:`, error);
        const message = axios.isAxiosError<{ message?: string }>(error)
          ? error.response?.data?.message ?? "Upload failed. Please retry."
          : error instanceof Error ? error.message : "Upload failed. Please retry.";
        setUploads((current) => current.map((upload) =>
          upload.id === item.id ? { ...upload, status: "failed", error: message } : upload,
        ));
      }
    } finally {
      uploadControllers.current.delete(item.id);
      uploadBatchActiveRef.current = false;
      setUploadBatchActive(false);
    }
    await refreshCloudFiles(item.folderId);
    await refreshDashboardStats();
  }

  function handleFileDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    if (uploadBatchActiveRef.current) return;
    if (["Trash", "Shared Links", "Shared With Me", "Versions"].includes(activePage)) {
      return;
    }
    void uploadSelectedFiles(Array.from(event.dataTransfer.files));
  }

  function choosePage(label: string) {
    setActivePage(label);
    setSelectedFileIds(new Set());

    if (label === "My Files" || label === "Dashboard") {
      setCurrentFolderId(null);
      setFolderPath([]);
    }

    setMobileMenu(false);
    setOpenMenuId(null);
    setSearch("");

    if (label === "Settings") {
      navigate("/settings");
      return;
    }

    if (label === "Trash") {
      void refreshTrash();
      return;
    }

    if (label === "Shared Links") {
      void refreshShareLinks();
      return;
    }

    if (label === "Shared With Me") {
      void refreshSharedWithMe();
      return;
    }

    if (label === "Versions") {
      setCurrentFolderId(null);
      setFolderPath([]);
      void loadAllFileVersions();
      return;
    }

    if (!["Dashboard", "My Files", "Shared With Me", "Shared Links", "Trash", "Versions"].includes(label)) {
      notify(`${label} view is not connected to the backend yet.`);
    }
  }

  async function handleLogout() {
    if (logoutLoading) return;

    setLogoutLoading(true);

    try {
      await logoutUser();
    } catch (error) {
      console.error("Logout request failed:", error);
    } finally {
      navigate("/login", { replace: true });
    }
  }

  useEffect(() => {
    if (!profileMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileMenuOpen]);

  const displayName = user?.name?.trim() || user?.email || "there";
  const profileName = user?.name?.trim() || user?.email || "User";
  const visibleFiles = filteredFiles;
  const hasMoreFiles = search.trim()
    ? searchPagination.page < searchPagination.totalPages
    : filePagination.page < filePagination.totalPages;
  const selectableFileIds = visibleFiles
    .filter((file) => file.type !== "Folder")
    .map((file) => file.id);
  const allVisibleFilesSelected =
    selectableFileIds.length > 0 &&
    selectableFileIds.every((id) => selectedFileIds.has(id));
  const storageUsed = formatSize(dashboardStats?.files.storageBytes);

  const pageTitle =
    activePage === "Dashboard"
      ? `Good to see you, ${displayName}!`
      : activePage;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleUploads}
      />

      {notice && (
        <div
          role="status"
          className="fixed right-5 top-5 z-[70] flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
        >
          <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
          <span>{notice}</span>
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notice"
            className="ml-2 rounded p-1 hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {uploads.length > 0 && (
        <section
          aria-label="Upload status"
          className="fixed bottom-5 right-5 z-[70] max-h-[50vh] w-[min(24rem,calc(100vw-2.5rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              Uploads {uploadBatchActive ? "in progress" : "finished"}
            </h2>
            <button
              type="button"
              onClick={() => setUploads([])}
              disabled={uploadBatchActive}
              aria-label="Dismiss upload statuses"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>
          <ul className="space-y-3">
            {uploads.map((item) => (
              <li key={item.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {item.file.name}
                    </p>
                    <p
                      className={`mt-1 text-xs ${
                        item.status === "failed"
                          ? "text-rose-600"
                          : item.status === "cancelled"
                            ? "text-amber-700"
                            : "text-slate-500"
                      }`}
                      role={item.status === "failed" ? "alert" : undefined}
                    >
                      {item.status === "failed"
                        ? item.error
                        : item.status === "complete"
                          ? "Upload complete"
                          : item.status === "cancelled"
                            ? "Upload cancelled"
                            : item.status === "queued"
                              ? "Waiting to upload"
                              : `Uploading ${item.progress}%`}
                    </p>
                  </div>
                  {item.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => void retryUpload(item)}
                      disabled={uploadBatchActive}
                      className="shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}
                  {(item.status === "queued" || item.status === "uploading") && (
                    <button
                      type="button"
                      onClick={() => cancelUpload(item)}
                      className="shrink-0 text-xs font-semibold text-rose-600 hover:text-rose-700"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {item.status === "uploading" && (
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
                    role="progressbar"
                    aria-label={`Uploading ${item.file.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={item.progress}
                  >
                    <div
                      className="h-full rounded-full bg-blue-600 transition-[width]"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex min-h-screen">
        {mobileMenu && (
          <button
            className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden"
            onClick={() => setMobileMenu(false)}
            aria-label="Close navigation"
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
            mobileMenu ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-20 items-center gap-3 px-7">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200">
              <Cloud size={26} strokeWidth={2.4} />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Cloud<span className="text-blue-600">Vault</span>
            </span>
            <button
              className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileMenu(false)}
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          </div>

          <div className="px-4 pt-6">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Workspace
            </p>
            <nav className="space-y-1">
              {navigation.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => choosePage(label)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                    activePage === label
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <Icon size={19} />
                  {label}
                  {label === "Trash" && trashedFiles.length > 0 && (
                    <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {trashedFiles.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="mt-auto p-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <HardDrive size={17} className="text-blue-600" />
                  Storage used
                </div>
              </div>
              <span className="text-xl font-bold text-slate-900">{storageUsed}</span>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Total size of your active files.
              </p>
            </div>
            <p className="mt-4 text-center text-xs text-slate-400">
              CloudVault · MVP Preview
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-20 items-center gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-8">
            <button
              onClick={() => setMobileMenu(true)}
              className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>

            <div className="relative w-full max-w-xl">
              <Search
                size={19}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder={
                  isTrashPage
                    ? "Search deleted files..."
                    : isSharedLinksPage
                      ? "Search share links..."
                      : isSharedWithMePage
                        ? "Search shared files..."
                        : "Search files and folders..."
                }
                aria-label="Search files and folders"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-3">
              <button
                onClick={() => notify("You're all caught up!")}
                className="relative rounded-xl p-2.5 text-slate-500 hover:bg-slate-100"
                aria-label="Notifications"
              >
                <Bell size={20} />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-white" />
              </button>

              <div className="hidden h-9 w-px bg-slate-200 sm:block" />

              <div ref={profileMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((isOpen) => !isOpen)}
                  className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-slate-50"
                  aria-haspopup="menu"
                  aria-expanded={profileMenuOpen}
                  aria-controls="profile-menu"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                    {(user?.name?.trim() || user?.email || "U")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <span className="hidden max-w-40 truncate text-sm font-semibold sm:block">
                    {profileName}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`text-slate-400 transition-transform ${
                      profileMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {profileMenuOpen && (
                  <div
                    id="profile-menu"
                    role="menu"
                    aria-label="Profile menu"
                    className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                  >
                    <div className="border-b border-slate-100 px-3 py-2.5">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {profileName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {user.email}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        navigate("/settings");
                      }}
                      className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Settings size={17} className="text-slate-400" />
                      <span>Account Settings</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleLogout()}
                      disabled={logoutLoading}
                      aria-busy={logoutLoading}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RefreshCw
                        size={17}
                        className={logoutLoading ? "animate-spin" : ""}
                      />
                      <span>{logoutLoading ? "Logging out…" : "Log Out"}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1600px] p-4 md:p-8">
            <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-sm font-medium text-blue-600">
                  {isTrashPage
                    ? "FILE RECOVERY"
                    : isSharedLinksPage
                      ? "LINK MANAGEMENT"
                      : isVersionsPage
                        ? "VERSION CONTROL"
                        : "YOUR PERSONAL CLOUD"}
                </p>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                  {pageTitle}
                </h1>
                <p className="mt-2 text-sm text-slate-500 md:text-base">
                  {isTrashPage
                    ? "Restore deleted files or permanently remove them from your vault."
                    : isSharedLinksPage
                      ? "Manage links you have created for your files."
                      : isVersionsPage
                        ? "Review and restore previous versions of your files."
                        : "Everything you need, organized in one secure place."}
                </p>
              </div>

              {!isTrashPage && !isSharedLinksPage && !isVersionsPage && (
                <button
                  onClick={() => uploadRef.current?.click()}
                  disabled={uploadBatchActive}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
                >
                  <Upload size={18} />
                  Upload files
                </button>
              )}
            </div>

            {!isTrashPage && !isSharedLinksPage && !isVersionsPage && (
              <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: "Total files",
                    value: String(dashboardStats?.files.total ?? files.filter((file) => file.type !== "Folder").length),
                    note: dashboardStatsError ? "Live count unavailable" : "Across your vault",
                    icon: FileText,
                    color: "text-blue-600",
                    bg: "bg-blue-50",
                  },
                  {
                    label: "Folders here",
                    value: String(files.filter((file) => file.type === "Folder").length),
                    note: "In this folder",
                    icon: Folder,
                    color: "text-violet-600",
                    bg: "bg-violet-50",
                  },
                  {
                    label: "Storage used",
                    value: storageUsed,
                    note: "Across active files",
                    icon: HardDrive,
                    color: "text-emerald-600",
                    bg: "bg-emerald-50",
                  },
                  {
                    label: "In trash",
                    value: String(dashboardStats?.trash.total ?? 0),
                    note: dashboardStatsError ? "Live count unavailable" : "Items awaiting recovery or deletion",
                    icon: Trash2,
                    color: "text-rose-600",
                    bg: "bg-rose-50",
                  },
                ].map(({ label, value, note, icon: Icon, color, bg }) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-500">{label}</span>
                      <div className={`rounded-xl p-2.5 ${bg} ${color}`}>
                        <Icon size={21} />
                      </div>
                    </div>
                    <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
                      {value}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{note}</p>
                  </div>
                ))}
              </section>
            )}

            <div
              className={`grid grid-cols-1 items-start gap-6 ${
                isTrashPage || isSharedLinksPage || isVersionsPage
                  ? ""
                  : "2xl:grid-cols-[minmax(0,1fr)_320px]"
              }`}
            >
              <section
                className="relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                onDragEnter={(event) => {
                  if (
                    event.dataTransfer.types.includes("Files") &&
                    !["Trash", "Shared Links", "Shared With Me", "Versions"].includes(activePage)
                  ) {
                    setDragActive(true);
                  }
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("Files")) {
                    event.preventDefault();
                  }
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragActive(false);
                  }
                }}
                onDrop={handleFileDrop}
              >
                {dragActive && (
                  <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-blue-600/10 p-6">
                    <p className="rounded-2xl border-2 border-dashed border-blue-500 bg-white px-8 py-6 text-center font-semibold text-blue-700 shadow-lg">
                      Drop files to upload to this folder
                    </p>
                  </div>
                )}
                <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {isTrashPage
                        ? "Deleted files"
                        : isSharedLinksPage
                          ? "Your share links"
                          : activePage === "Dashboard"
                            ? "Recent files"
                            : activePage}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isTrashPage
                        ? `${filteredTrash.length} deleted item(s)`
                        : isSharedLinksPage
                          ? `${shareLinks.length} share link(s)`
                          : isVersionsPage
                            ? `${allFileVersions.length} previous version(s)`
                            : search
                            ? `${visibleFiles.length} matching items`
                            : "Your files and folders at a glance"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleRefresh()}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw size={16} />
                      Refresh
                    </button>

                    {!isTrashPage && !isSharedLinksPage && !isVersionsPage && (
                      <>
                        <button
                          onClick={() => uploadRef.current?.click()}
                          disabled={uploadBatchActive}
                          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                          <Upload size={16} />
                          Upload
                        </button>
                        <button
                          onClick={() => setFolderDialog(true)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <FolderPlus size={16} />
                          New folder
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {fileError && !isTrashPage && (
                  <div
                    role="alert"
                    className="m-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
                  >
                    <AlertCircle size={19} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">{fileError}</p>
                      <button
                        onClick={() => void refreshCloudFiles()}
                        className="mt-2 font-semibold underline"
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                )}

                {searchError && !isTrashPage && !isSharedLinksPage && !isVersionsPage && (
                  <div role="alert" className="mx-5 mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {searchError}
                  </div>
                )}

                {!isTrashPage && !isSharedLinksPage && !isVersionsPage && (
                  <nav
                    aria-label="Folder breadcrumbs"
                    className="flex flex-wrap items-center gap-2 px-5 pb-3 text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => navigateToFolder(-1)}
                      className={`font-semibold ${folderPath.length === 0 ? "text-slate-800" : "text-blue-600 hover:text-blue-700"}`}
                    >
                      My Files
                    </button>
                    {folderPath.map((folder, index) => (
                      <span key={folder.id} className="inline-flex items-center gap-2">
                        <span className="text-slate-400">/</span>
                        <button
                          type="button"
                          onClick={() => navigateToFolder(index)}
                          className={`max-w-[180px] truncate font-semibold ${index === folderPath.length - 1 ? "text-slate-800" : "text-blue-600 hover:text-blue-700"}`}
                        >
                          {folder.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                )}

                {isTrashPage ? (
                  <>
                    {trashError && (
                      <div
                        role="alert"
                        className="m-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
                      >
                        <AlertCircle size={19} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">{trashError}</p>
                          <button
                            onClick={() => void refreshTrash()}
                            className="mt-2 font-semibold underline"
                          >
                            Try again
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedFileIds.size > 0 && (
                      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-blue-50/60 px-5 py-3">
                        <span className="mr-auto text-sm font-semibold text-slate-700">
                          {selectedFileIds.size} selected
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleBulkFileAction("restore")}
                          disabled={bulkActionLoading}
                          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50"
                        >
                          Restore selected
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBulkFileAction("permanently-delete")}
                          disabled={bulkActionLoading}
                          className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                        >
                          Delete selected
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedFileIds(new Set())}
                          disabled={bulkActionLoading}
                          className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-4">
                              <input
                                type="checkbox"
                                aria-label="Select all visible trashed files"
                                checked={
                                  filteredTrash.length > 0 &&
                                  filteredTrash.every((file) => selectedFileIds.has(file.id))
                                }
                                onChange={(event) => {
                                  setSelectedFileIds((current) => {
                                    const next = new Set(current);
                                    for (const file of filteredTrash) {
                                      if (event.target.checked) next.add(file.id);
                                      else next.delete(file.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </th>
                            <th className="px-5 py-4">Name</th>
                            <th className="px-4 py-4">Date deleted</th>
                            <th className="px-4 py-4">Size</th>
                            <th className="px-4 py-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredTrash.map((file) => (
                            <tr key={file.id} className="group transition hover:bg-slate-50">
                              <td className="px-4 py-3.5">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${file.name || file.originalName}`}
                                  checked={selectedFileIds.has(file.id)}
                                  onChange={(event) => {
                                    setSelectedFileIds((current) => {
                                      const next = new Set(current);
                                      if (event.target.checked) next.add(file.id);
                                      else next.delete(file.id);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-3">
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500">
                                    <File size={21} />
                                  </span>
                                  <span>
                                    <span className="block max-w-[260px] truncate text-sm font-semibold text-slate-800">
                                      {file.name || file.originalName}
                                    </span>
                                    <span className="mt-1 block text-xs text-slate-400">
                                      {file.mimeType || "File"}
                                    </span>
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3.5 text-sm text-slate-500">
                                {formatDate(file.deletedAt)}
                              </td>
                              <td className="px-4 py-3.5 text-sm text-slate-500">
                                {formatSize(file.size)}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => void handleRestoreTrashedFile(file)}
                                    disabled={trashLoading}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                  >
                                    <RotateCcw size={15} />
                                    Restore
                                  </button>
                                  <button
                                    onClick={() => void handlePermanentlyDeleteTrashedFile(file)}
                                    disabled={trashLoading}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    <Trash2 size={15} />
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {trashLoading && (
                      <div className="px-5 py-10 text-center text-sm text-slate-500">
                        Loading your trash…
                      </div>
                    )}

                    {!trashLoading && !trashError && filteredTrash.length === 0 && (
                      <div className="px-5 py-16 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                          <Trash2 size={27} />
                        </div>
                        <p className="mt-4 font-semibold text-slate-800">
                          {search ? "No deleted files match your search" : "Your trash is empty"}
                        </p>
                        <p className="mt-2 text-sm text-slate-500">
                          {search
                            ? "Try a different search term."
                            : "Files you move to Trash will appear here."}
                        </p>
                        {search && (
                          <button
                            onClick={() => setSearch("")}
                            className="mt-4 text-sm font-semibold text-blue-600"
                          >
                            Clear search
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
                      <span className="text-xs text-slate-500">
                        {filteredTrash.length} of {trashedFiles.length} deleted item(s)
                      </span>
                      <button
                        onClick={() => choosePage("My Files")}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Back to My Files <ArrowRight size={16} />
                      </button>
                    </div>
                  </>
                ) : isSharedWithMePage ? (
                  <div className="p-5">
                    {sharedWithMeError && (
                      <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        <AlertCircle size={19} className="mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold">{sharedWithMeError}</p>
                          <button onClick={() => void refreshSharedWithMe()} className="mt-2 font-semibold underline">Try again</button>
                        </div>
                      </div>
                    )}
                    {sharedWithMeLoading ? (
                      <div className="py-12 text-center text-sm text-slate-500">
                        <RefreshCw size={20} className="mx-auto mb-3 animate-spin" />
                        Loading files shared with you…
                      </div>
                    ) : filteredSharedWithMe.length === 0 ? (
                      <div className="py-14 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                          <Users size={26} />
                        </div>
                        <p className="mt-4 font-semibold text-slate-800">No files shared with you yet</p>
                        <p className="mt-2 text-sm text-slate-500">When other users share files with your email, they will appear here.</p>
                        <button onClick={() => choosePage("My Files")} className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700">Browse files</button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredSharedWithMe.map((item) => {
                          const presentation = getFilePresentation(item.file.mimeType);
                          const Icon = presentation.icon;
                          const isEditor = item.permission === "EDIT";
                          return (
                            <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-start gap-3">
                                <div className={`rounded-xl p-3 ${presentation.bg} ${presentation.color}`}>
                                  <Icon size={20} />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-800">{item.file.name}</p>
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    Shared by <span className="font-medium text-slate-700">{item.file.owner.name || item.file.owner.email}</span> · {formatSize(item.file.size)}
                                  </p>
                                  <p className="mt-0.5 text-xs text-slate-400">
                                    Shared {formatDate(item.createdAt)} · {item.expiresAt ? `Expires ${formatDate(item.expiresAt)}` : "Never expires"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isEditor ? "bg-violet-50 text-violet-700" : "bg-emerald-50 text-emerald-700"}`}>
                                  {isEditor ? "Editor" : "Viewer"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handlePreviewSharedFileForUser(item)}
                                  disabled={previewLoadingId === item.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  <Eye size={15} />
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadSharedFileForUser(item)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                                >
                                  <Download size={15} />
                                  Download
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : isSharedLinksPage ? (
                  <div className="p-5">
                    {shareLinksError && (
                      <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        <AlertCircle size={19} className="mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold">{shareLinksError}</p>
                          <button onClick={() => void refreshShareLinks()} className="mt-2 font-semibold underline">Try again</button>
                        </div>
                      </div>
                    )}
                    {shareLinksLoading ? (
                      <div className="py-12 text-center text-sm text-slate-500">
                        <RefreshCw size={20} className="mx-auto mb-3 animate-spin" />
                        Loading share links…
                      </div>
                    ) : filteredSharedLinks.length === 0 ? (
                      <div className="py-14 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Link2 size={26} /></div>
                        <p className="mt-4 font-semibold text-slate-800">No share links yet</p>
                        <p className="mt-2 text-sm text-slate-500">Create a link from a file’s action menu to share it securely.</p>
                        <button onClick={() => choosePage("My Files")} className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700">Browse files</button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredSharedLinks.map((link) => (
                          <div key={link.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="rounded-xl bg-blue-50 p-3 text-blue-600"><Link2 size={20} /></div>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-slate-800">{link.file.name}</p>
                                <p className="mt-0.5 text-xs text-slate-600">
                                  {link.sharedWithEmail ? `Shared with: ${link.sharedWithEmail}` : "Public link"} · {formatSize(link.file.size)}
                                </p>
                                <p className="mt-0.5 text-xs text-slate-400">
                                  Created {formatDate(link.createdAt)} · {link.revokedAt ? "Revoked" : link.expiresAt ? `Expires ${formatDate(link.expiresAt)}` : "Never expires"}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${link.permission === "EDIT" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>
                                {link.permission === "EDIT" ? "Editor" : "Viewer"}
                              </span>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${link.revokedAt ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{link.revokedAt ? "Revoked" : "Active"}</span>
                              {!link.revokedAt && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingShareLink(link);
                                      setEditPermission((link.permission as "VIEW" | "EDIT") || "VIEW");
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    <Pencil size={14} />
                                    Permissions
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRevokeShareLink(link.id)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 size={14} />
                                    Revoke
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : isVersionsPage ? (
                  <div className="p-5">
                    {allVersionsError && (
                      <div
                        role="alert"
                        className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
                      >
                        <AlertCircle size={19} className="mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold">{allVersionsError}</p>
                          <button
                            type="button"
                            onClick={() => void loadAllFileVersions()}
                            className="mt-2 font-semibold underline"
                          >
                            Try again
                          </button>
                        </div>
                      </div>
                    )}

                    {allVersionsLoading ? (
                      <div className="py-12 text-center text-sm text-slate-500">
                        <RefreshCw size={20} className="mx-auto mb-3 animate-spin" />
                        Loading file versions…
                      </div>
                    ) : allFileVersions.length === 0 ? (
                      <div className="py-14 text-center">
                        <History size={30} className="mx-auto text-slate-300" />
                        <p className="mt-4 font-semibold text-slate-800">
                          No previous versions found
                        </p>
                        <p className="mt-2 text-sm text-slate-500">
                          Previous versions will appear here after you upload a new version of a file.
                        </p>
                        <button
                          type="button"
                          onClick={() => choosePage("My Files")}
                          className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700"
                        >
                          Browse files
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {allFileVersions
                          .filter(({ file }) =>
                            file.name.toLowerCase().includes(search.trim().toLowerCase()),
                          )
                          .map(({ file, version }) => (
                            <div
                              key={`${file.id}-${version.id}`}
                              className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <div className={`rounded-xl p-3 ${file.bg} ${file.color}`}>
                                  <History size={20} />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-800">
                                    {file.name}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-600">
                                    Version {version.version}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {formatDate(version.createdAt)} · {formatSize(version.size)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadFileVersion(file, version)}
                                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  <Download size={15} />
                                  Download
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleRestoreFromVersionsPage(file, version)}
                                  disabled={versionRestoringId !== null || allVersionsLoading}
                                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {versionRestoringId === version.id ? (
                                    <RefreshCw size={15} className="animate-spin" />
                                  ) : (
                                    <RotateCcw size={15} />
                                  )}
                                  {versionRestoringId === version.id ? "Restoring…" : "Restore"}
                                </button>
                              </div>
                            </div>
                          ))}
                        {allFileVersions.filter(({ file }) =>
                          file.name.toLowerCase().includes(search.trim().toLowerCase()),
                        ).length === 0 && (
                          <div className="py-10 text-center text-sm text-slate-500">
                            No versions match “{search}”.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {!isSharedWithMePage && (
                      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                          Sort by
                          <select
                            value={sortBy}
                            onChange={(event) =>
                              changeSortBy(event.target.value as typeof sortBy)
                            }
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-blue-400"
                          >
                            <option value="updatedAt">Modified</option>
                            <option value="createdAt">Created</option>
                            <option value="name">Name</option>
                            <option value="size">Size</option>
                            <option value="mimeType">File type</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={changeSortOrder}
                          aria-label={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          {sortOrder === "asc" ? "Ascending" : "Descending"}
                        </button>
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                          Type
                          <select
                            value={mimeTypeFilter}
                            onChange={(event) => changeMimeTypeFilter(event.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-blue-400"
                          >
                            <option value="">All types</option>
                            <option value="image/*">Images</option>
                            <option value="text/*">Text</option>
                            <option value="application/pdf">PDF</option>
                            <option value="audio/*">Audio</option>
                            <option value="video/*">Video</option>
                          </select>
                        </label>
                      </div>
                    )}
                    {selectedFileIds.size > 0 && (
                      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-blue-50/60 px-5 py-3">
                        <span className="mr-auto text-sm font-semibold text-slate-700">
                          {selectedFileIds.size} selected
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleBulkFileAction("trash")}
                          disabled={bulkActionLoading}
                          className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                        >
                          Move to Trash
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedFileIds(new Set())}
                          disabled={bulkActionLoading}
                          className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-4">
                              <input
                                type="checkbox"
                                aria-label="Select all visible files"
                                checked={allVisibleFilesSelected}
                                onChange={(event) => {
                                  setSelectedFileIds((current) => {
                                    const next = new Set(current);
                                    for (const id of selectableFileIds) {
                                      if (event.target.checked) next.add(id);
                                      else next.delete(id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </th>
                            <th className="px-5 py-4">Name</th>
                            <th className="px-4 py-4">Last modified</th>
                            <th className="px-4 py-4">Size</th>
                            <th className="px-4 py-4">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {visibleFiles.map((file) => {
                            const Icon = file.icon;

                            return (
                              <tr key={file.id} className="group transition hover:bg-slate-50">
                                <td className="px-4 py-3.5">
                                  {file.type !== "Folder" && (
                                    <input
                                      type="checkbox"
                                      aria-label={`Select ${file.name}`}
                                      checked={selectedFileIds.has(file.id)}
                                      onChange={(event) => {
                                        setSelectedFileIds((current) => {
                                          const next = new Set(current);
                                          if (event.target.checked) next.add(file.id);
                                          else next.delete(file.id);
                                          return next;
                                        });
                                      }}
                                    />
                                  )}
                                </td>
                                <td className="px-5 py-3.5">
                                  <button
                                    onClick={() => {
                                      if (file.type === "Folder") {
                                        openFolder(file);
                                      } else {
                                        void handlePreview(file);
                                      }
                                    }}
                                    className="flex items-center gap-3 text-left"
                                  >
                                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${file.bg} ${file.color}`}>
                                      <Icon size={21} />
                                    </span>
                                    <span>
                                      <span className="block max-w-[230px] truncate text-sm font-semibold text-slate-800">
                                        {file.name}
                                      </span>
                                      <span className="mt-1 block text-xs text-slate-400">
                                        {file.type}
                                      </span>
                                    </span>
                                  </button>
                                </td>
                                <td className="px-4 py-3.5 text-sm text-slate-500">
                                  {file.modified}
                                </td>
                                <td className="px-4 py-3.5 text-sm text-slate-500">
                                  {file.size}
                                </td>
                                <td className="px-4 py-3.5">
                                  <div className="relative">
                                    <button
                                      onClick={() =>
                                        setOpenMenuId((current) =>
                                          current === file.id ? null : file.id,
                                        )
                                      }
                                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                      aria-label={`More actions for ${file.name}`}
                                      aria-expanded={openMenuId === file.id}
                                    >
                                      <MoreVertical size={18} />
                                    </button>

                                    {openMenuId === file.id && (
                                      <div className="absolute right-0 top-full z-20 mt-1 min-w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                                        {file.type !== "Folder" ? (
                                          <>
                                            {(file.mimeType.startsWith("image/") ||
                                              file.mimeType === "application/pdf" ||
                                              file.mimeType.startsWith("text/") ||
                                              [
                                                "application/json",
                                                "application/xml",
                                                "application/javascript",
                                                "application/x-yaml",
                                                "application/yaml",
                                                "application/markdown",
                                              ].includes(file.mimeType)) && (
                                              <button
                                                onClick={() => void handlePreview(file)}
                                                disabled={previewLoadingId === file.id}
                                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                              >
                                                <Eye size={16} />
                                                {previewLoadingId === file.id ? "Loading preview…" : "Preview"}
                                              </button>
                                            )}
                                            <button
                                              onClick={() => void handleDownload(file.id, file.name)}
                                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                              <Download size={16} />
                                              Download
                                            </button>
                                            <button
                                              onClick={() => void handleOpenVersions(file)}
                                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                              <History size={16} />
                                              Version History
                                            </button>
                                            <button
                                              onClick={() => {
                                                setOpenMenuId(null);
                                                setShareDialogFile(file);
                                                setShareExpiry("never");
                                                setCreatedShareUrl("");
                                              }}
                                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                              <Share2 size={16} />
                                              Share link
                                            </button>
                                            <button
                                              onClick={() => void handleRename(file.id, file.name)}
                                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                              <Pencil size={16} />
                                              Rename
                                            </button>
                                            <button
                                              onClick={() => void handleOpenMoveDialog(file)}
                                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                              <Folder size={16} />
                                              Move file
                                            </button>
                                            <button
                                              onClick={() => void handleMoveToTrash(file.id, file.name)}
                                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                            >
                                              <Trash size={16} />
                                              Move to Trash
                                            </button>
                                          </>
                                          ) : (
                                            <>
                                              <button
                                                onClick={() => void handleRenameFolder(file.id, file.name)}
                                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                              >
                                                <Pencil size={16} />
                                                Rename
                                              </button>
                                              <button
                                                onClick={() => void handleOpenMoveDialog(file)}
                                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                              >
                                                <Folder size={16} />
                                                Move folder
                                              </button>
                                              <button
                                                onClick={() =>
                                                  void handleDeleteFolder(file.id, file.name)
                                                }
                                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                              >
                                                <Trash size={16} />
                                                Delete folder
                                              </button>
                                            </>
                                          )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {(loading || searchLoading) && (
                      <div className="px-5 py-10 text-center text-sm text-slate-500">
                        {searchLoading ? "Searching your files…" : "Loading your files…"}
                      </div>
                    )}

                    {!loading && !searchLoading && !fileError && !searchError && visibleFiles.length === 0 && (
                      <div className="px-5 py-14 text-center">
                        <Search size={28} className="mx-auto text-slate-300" />
                        <p className="mt-3 font-semibold text-slate-700">
                          {search ? "No matching files found" : "No files yet"}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          Try another search term or upload a file.
                        </p>
                        {search && (
                          <button
                            onClick={() => setSearch("")}
                            className="mt-3 text-sm font-semibold text-blue-600"
                          >
                            Clear search
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
                      <span className="text-xs text-slate-500">
                        Showing {visibleFiles.length} item(s)
                      </span>
                      <div className="flex items-center gap-3">
                        {hasMoreFiles && (
                          <button
                            type="button"
                            onClick={() => void loadMoreFiles()}
                            disabled={loading || searchLoading}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Load more
                          </button>
                        )}
                        {activePage === "Dashboard" && (
                          <button
                            onClick={() => choosePage("My Files")}
                            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
                          >
                            View all files <ArrowRight size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </section>

              {!isTrashPage && !isSharedLinksPage && !isVersionsPage && (
                <div className="space-y-6">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="font-bold text-slate-900">Quick actions</h2>
                    <p className="mt-1 text-sm text-slate-500">Get things done faster.</p>
                    <div className="mt-5 space-y-2">
                      <button
                        onClick={() => uploadRef.current?.click()}
                        disabled={uploadBatchActive}
                        className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-blue-50"
                      >
                        <span className="rounded-xl bg-blue-50 p-3 text-blue-600">
                          <Upload size={20} />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold">Upload files</span>
                          <span className="mt-1 block text-xs text-slate-500">Add files to your vault</span>
                        </span>
                      </button>
                      <button
                        onClick={() => setFolderDialog(true)}
                        className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-violet-50"
                      >
                        <span className="rounded-xl bg-violet-50 p-3 text-violet-600">
                          <FolderPlus size={20} />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold">Create folder</span>
                          <span className="mt-1 block text-xs text-slate-500">Organize your files</span>
                        </span>
                      </button>
                      <button
                        onClick={() => choosePage("Shared Links")}
                        className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-emerald-50"
                      >
                        <span className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
                          <Link2 size={20} />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold">Shared links</span>
                          <span className="mt-1 block text-xs text-slate-500">Manage shared files</span>
                        </span>
                      </button>
                      <button
                        onClick={() => choosePage("Trash")}
                        className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-red-50"
                      >
                        <span className="rounded-xl bg-red-50 p-3 text-red-600">
                          <Trash2 size={20} />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold">Open Trash</span>
                          <span className="mt-1 block text-xs text-slate-500">Restore or remove deleted files</span>
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h2 className="font-bold text-slate-900">Recent activity</h2>
                      <Clock3 size={17} className="text-slate-400" />
                    </div>
                    <div className="mt-4 space-y-3.5">
                      {activitiesLoading ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                          <RefreshCw size={16} className="mx-auto mb-2 animate-spin text-slate-400" />
                          Loading activities…
                        </div>
                      ) : activitiesError ? (
                        <div className="py-4 text-center text-xs text-red-500">
                          {activitiesError}
                          <button
                            type="button"
                            onClick={() => void loadRecentActivities()}
                            className="ml-2 font-semibold underline"
                          >
                            Retry
                          </button>
                        </div>
                      ) : activities.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                          No recent activity yet. Upload or share files to see events here.
                        </div>
                      ) : (
                        activities.slice(0, 6).map((act) => {
                          const presentation = getActivityPresentation(act.action);
                          const Icon = presentation.icon;
                          return (
                            <div key={act.id} className="flex items-start gap-3">
                              <span className={`shrink-0 rounded-xl p-2 ${presentation.bg} ${presentation.color}`}>
                                <Icon size={16} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-800">
                                  {getActivityTitle(act)}
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-400">
                                  {formatDate(act.createdAt)}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-lg shadow-blue-100">
                    <div className="flex items-center gap-2 text-blue-100">
                      <HardDrive size={19} />
                      <span className="text-sm font-medium">Your cloud storage</span>
                    </div>
                    <p className="mt-4 text-2xl font-bold">
                      {storageUsed}
                    </p>
                    <p className="mt-3 text-xs text-blue-100">
                      Total size of your active files.
                    </p>
                  </section>
                </div>
              )}
            </div>

            <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-slate-200 py-5 text-xs text-slate-400 sm:flex-row">
              <span>© 2026 CloudVault · Your files, your space.</span>
              <span>Secure cloud storage · MVP Preview</span>
            </footer>
          </div>
        </main>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${preview.name}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-slate-900">{preview.name}</h2>
                <p className="text-xs text-slate-500">
                  {preview.mimeType === "application/pdf"
                    ? "PDF preview"
                    : preview.mimeType.startsWith("image/")
                      ? "Image preview"
                      : "Text preview"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={preview.url}
                  download={preview.name}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download size={16} />
                  <span className="hidden sm:inline">Download</span>
                </a>
                <button
                  onClick={closePreview}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close preview"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-3 sm:p-6">
              {preview.mimeType.startsWith("image/") ? (
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="max-h-[78vh] max-w-full rounded-lg object-contain shadow-sm"
                />
              ) : preview.mimeType === "application/pdf" ? (
                <iframe
                  src={preview.url}
                  title={`Preview of ${preview.name}`}
                  className="h-[78vh] w-full rounded-lg border border-slate-200 bg-white"
                />
              ) : (
                <TextPreview key={preview.url} blob={preview.blob} />
              )}
            </div>
          </div>
        </div>
      )}

      {folderDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFolderDialog(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-dialog-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                  <FolderPlus size={22} />
                </div>
                <div>
                  <h2 id="folder-dialog-title" className="text-lg font-bold text-slate-900">
                    Create a folder
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Give your new folder a name.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setFolderDialog(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={createFolder}>
              <label htmlFor="folder-name" className="mb-2 block text-sm font-medium text-slate-700">
                Folder name
              </label>
              <input
                id="folder-name"
                autoFocus
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="e.g. Work Documents"
                maxLength={100}
                required
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
              />
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFolderDialog(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Plus size={17} />
                  Create folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move File Dialog */}
      {moveDialogFile && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !moveSubmitting) {
              setMoveDialogFile(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-dialog-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                  <Folder size={22} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="move-dialog-title"
                    className="text-lg font-bold text-slate-900"
                  >
                    Move {moveDialogFile.type === "Folder" ? "folder" : "file"}
                  </h2>
                  <p className="mt-1 break-words text-sm text-slate-500">
                    Choose a destination for {moveDialogFile.name}.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMoveDialogFile(null)}
                disabled={moveSubmitting}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            {moveLoading ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Loading folders…
              </p>
            ) : (
              <>
                <label
                  htmlFor="move-destination"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Destination folder
                </label>

                <select
                  id="move-destination"
                  value={moveDestinationId}
                  onChange={(event) =>
                    setMoveDestinationId(event.target.value)
                  }
                  disabled={moveSubmitting}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:opacity-60"
                >
                  <option value="">My Files (Root)</option>
                  {moveFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setMoveDialogFile(null)}
                    disabled={moveSubmitting}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleMoveFile()}
                    disabled={moveSubmitting}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Folder size={16} />
                    {moveSubmitting
                      ? "Moving…"
                      : `Move ${moveDialogFile.type === "Folder" ? "folder" : "file"}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Version History Dialog */}
      {versionDialogFile && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !versionUploading &&
              !versionRestoringId
            ) {
              setVersionDialogFile(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="versions-dialog-title"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                  <History size={22} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="versions-dialog-title"
                    className="text-lg font-bold text-slate-900"
                  >
                    Version History
                  </h2>
                  <p className="mt-1 break-words text-sm text-slate-500">
                    Manage previous versions of {versionDialogFile.name}.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setVersionDialogFile(null)}
                disabled={versionUploading || versionRestoringId !== null}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            <input
              ref={versionUploadRef}
              type="file"
              className="hidden"
              onChange={(event) => void handleUploadNewVersion(event)}
            />

            <button
              type="button"
              onClick={() => versionUploadRef.current?.click()}
              disabled={versionUploading || versionsLoading || versionRestoringId !== null}
              className="mb-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {versionUploading ? (
                <RefreshCw size={17} className="animate-spin" />
              ) : (
                <Upload size={17} />
              )}
              {versionUploading ? "Uploading new version…" : "Upload New Version"}
            </button>

            {versionsLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Loading version history…
              </p>
            ) : versionsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p>{versionsError}</p>
                <button
                  type="button"
                  onClick={() => void handleOpenVersions(versionDialogFile)}
                  className="mt-2 font-semibold underline"
                >
                  Try again
                </button>
              </div>
            ) : fileVersions.length === 0 ? (
              <div className="rounded-xl border border-slate-200 py-8 text-center">
                <History size={28} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  No previous versions
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Upload a new version to start tracking changes.
                </p>
              </div>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {fileVersions.map((version) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
                        <File size={19} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          Version {version.version}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(version.createdAt)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatSize(version.size)}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleRestoreVersion(version)}
                      disabled={versionRestoringId !== null || versionUploading}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {versionRestoringId === version.id ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                      {versionRestoringId === version.id
                        ? "Restoring…"
                        : "Restore"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setVersionDialogFile(null)}
                disabled={versionUploading || versionRestoringId !== null}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share File Dialog */}
      {shareDialogFile && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !shareSubmitting) {
              setShareDialogFile(null);
              setCreatedShareUrl("");
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                  <Share2 size={22} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="share-dialog-title"
                    className="text-lg font-bold text-slate-900"
                  >
                    Share file
                  </h2>
                  <p className="mt-1 break-words text-sm text-slate-500">
                    Create a secure link for {shareDialogFile.name}.
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShareDialogFile(null);
                  setCreatedShareUrl("");
                }}
                disabled={shareSubmitting}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Close share dialog"
              >
                <X size={20} />
              </button>
            </div>

            {!createdShareUrl ? (
              <>
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="share-permission"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      Access permission
                    </label>
                    <select
                      id="share-permission"
                      value={sharePermission}
                      onChange={(event) =>
                        setSharePermission(event.target.value as "VIEW" | "EDIT")
                      }
                      disabled={shareSubmitting}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                    >
                      <option value="VIEW">Viewer — Can view and download</option>
                      <option value="EDIT">Editor — Can view, download, and update</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="share-recipient"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      Share with specific user (optional)
                    </label>
                    <input
                      id="share-recipient"
                      type="email"
                      placeholder="user@example.com"
                      value={shareRecipientEmail}
                      onChange={(event) => setShareRecipientEmail(event.target.value)}
                      disabled={shareSubmitting}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Leave empty to create a public link accessible to anyone with the URL.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="share-expiry"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      Link expiration
                    </label>

                    <select
                      id="share-expiry"
                      value={shareExpiry}
                      onChange={(event) => setShareExpiry(event.target.value)}
                      disabled={shareSubmitting}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                    >
                      <option value="never">Never expires</option>
                      <option value="1">Expires in 1 day</option>
                      <option value="7">Expires in 7 days</option>
                      <option value="30">Expires in 30 days</option>
                    </select>
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShareDialogFile(null);
                      setShareRecipientEmail("");
                      setSharePermission("VIEW");
                    }}
                    disabled={shareSubmitting}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCreateShareLink()}
                    disabled={shareSubmitting}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Link2 size={16} />
                    {shareSubmitting ? "Creating link…" : "Create share link"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 size={18} />
                    Share link created
                  </div>
                  <p className="mt-1 text-xs leading-5">
                    Copy the link now. For security, the token is only returned
                    when the link is created.
                  </p>
                </div>

                <label
                  htmlFor="created-share-url"
                  className="mb-2 mt-5 block text-sm font-medium text-slate-700"
                >
                  Share URL
                </label>

                <input
                  id="created-share-url"
                  readOnly
                  value={createdShareUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none"
                />

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShareDialogFile(null);
                      setCreatedShareUrl("");
                      setShareRecipientEmail("");
                      setSharePermission("VIEW");
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Done
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopyShareUrl()}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    <Copy size={16} />
                    Copy link
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {editingShareLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-permission-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="edit-permission-title" className="text-lg font-bold text-slate-900">
                Update permissions
              </h2>
              <button
                type="button"
                onClick={() => setEditingShareLink(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Manage access level for <span className="font-semibold text-slate-700">{editingShareLink.file.name}</span>.
            </p>

            <div className="mt-4">
              <label htmlFor="edit-perm-select" className="mb-1.5 block text-sm font-medium text-slate-700">
                Access permission
              </label>
              <select
                id="edit-perm-select"
                value={editPermission}
                onChange={(e) => setEditPermission(e.target.value as "VIEW" | "EDIT")}
                disabled={editSubmitting}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
              >
                <option value="VIEW">Viewer — Can view and download</option>
                <option value="EDIT">Editor — Can view, download, and update</option>
              </select>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingShareLink(null)}
                disabled={editSubmitting}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUpdateSharePermission()}
                disabled={editSubmitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {editSubmitting ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
