import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import { getCurrentUser } from "../lib/auth";
import type { User } from "../lib/auth";
import {
  listFiles,
  listFolders,
  uploadFile,
  downloadCloudFile,
  createFolder as createCloudFolder,
  renameCloudFile,
  moveFileToTrash,
  listTrashedFiles,
  restoreTrashedFile,
  permanentlyDeleteTrashedFile,
  type CloudFile,
  type CloudFolder,
  type TrashedCloudFile,
  createShareLink,
  listShareLinks,
  revokeShareLink,
  type ShareLink,
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
  size: string;
  icon: LucideIcon;
  color: string;
  bg: string;
};

type PreviewItem = {
  name: string;
  mimeType: string;
  url: string;
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

export default function DashboardPage() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileError, setFileError] = useState("");

  const [trashedFiles, setTrashedFiles] = useState<TrashedCloudFile[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState("");

  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const [shareLinks, setShareLinks] = useState<(ShareLink & { fileName: string })[]>([]);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [shareLinksError, setShareLinksError] = useState("");
  const [shareDialogFile, setShareDialogFile] = useState<FileItem | null>(null);
  const [shareExpiry, setShareExpiry] = useState("never");
  const [createdShareUrl, setCreatedShareUrl] = useState("");
  const [shareSubmitting, setShareSubmitting] = useState(false);

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

  async function refreshCloudFiles() {
    setFileError("");

    try {
      const [cloudFiles, cloudFolders] = await Promise.all([
        listFiles(),
        listFolders(),
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
        size: "—",
        icon: Folder,
        color: "text-blue-600",
        bg: "bg-blue-50",
      });

      setFiles([
        ...cloudFolders.map(mapFolder),
        ...cloudFiles.map(mapFile),
      ]);
    } catch (error) {
      console.error("Failed to load CloudVault files:", error);
      setFileError(
        "Couldn't load files. Check that the backend is running and you're signed in.",
      );
    } finally {
      setLoading(false);
    }
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

    if (
      !file.mimeType.startsWith("image/") &&
      file.mimeType !== "application/pdf"
    ) {
      notify("Preview is available for images and PDF files only.");
      return;
    }

    setPreviewLoadingId(file.id);

    try {
      const blob = await downloadCloudFile(file.id);
      const url = URL.createObjectURL(blob);

      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          name: file.name,
          mimeType: file.mimeType,
          url,
        };
      });
    } catch (error) {
      console.error(`Failed to preview ${file.name}:`, error);
      notify(`Couldn't preview ${file.name}. Please try again.`);
    } finally {
      setPreviewLoadingId(null);
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
  
  async function refreshShareLinks() {
    setShareLinksLoading(true);
    setShareLinksError("");

    try {
      const cloudFiles = await listFiles();
      const results = await Promise.all(
        cloudFiles.map(async (file) => {
          const links = await listShareLinks(file.id);
          return links.map((link) => ({
            ...link,
            fileName: file.name || file.originalName,
          }));
        }),
      );
      setShareLinks(results.flat());
    } catch (error) {
      console.error("Failed to load share links:", error);
      setShareLinksError("Couldn't load share links. Please try again.");
    } finally {
      setShareLinksLoading(false);
    }
  }

  async function handleCreateShareLink() {
    if (!shareDialogFile) return;

    setShareSubmitting(true);

    try {
      let expiresAt: string | null = null;

      if (shareExpiry !== "never") {
        const days = Number(shareExpiry);
        const expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        expiresAt = expiryDate.toISOString();
      }

      const result = await createShareLink(shareDialogFile.id, expiresAt);

      const apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL ??
        "http://localhost:8000/api/v1";

      const normalizedBaseUrl = apiBaseUrl.replace(/\/+$/, "");
      const shareUrl =
        `${normalizedBaseUrl}/shared/${encodeURIComponent(result.token)}`;

      setCreatedShareUrl(shareUrl);
      await refreshShareLinks();
      notify("Share link created successfully.");
    } catch (error) {
      console.error("Failed to create share link:", error);
      notify("Couldn't create the share link. Please try again.");
    } finally {
      setShareSubmitting(false);
    }
  }

  async function handleRevokeShareLink(linkId: string) {
    if (!window.confirm("Revoke this share link? Anyone using it will lose access.")) {
      return;
    }

    try {
      await revokeShareLink(linkId);
      await refreshShareLinks();
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

  async function handleMoveToTrash(fileId: string, fileName: string) {
    setOpenMenuId(null);

    if (!window.confirm(`Move "${fileName}" to Trash?`)) return;

    try {
      await moveFileToTrash(fileId);
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
      await refreshTrash();
      notify(`"${fileName}" permanently deleted.`);
    } catch (error) {
      console.error(`Failed to permanently delete ${fileName}:`, error);
      notify("Could not permanently delete this file. Please try again.");
    }
  }

  async function handleRefresh() {
    if (activePage === "Trash") {
      await refreshTrash();
    } else if (activePage === "Shared Links") {
      await refreshShareLinks();
    } else {
      await refreshCloudFiles();
    }
  }

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then((currentUser) => {
        if (active) setUser(currentUser);
      })
      .catch((error: unknown) => {
        console.error("Failed to load current user:", error);
      });

    void refreshCloudFiles();

    return () => {
      active = false;

      if (noticeTimer.current !== undefined) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const filteredFiles = useMemo(
    () =>
      files.filter((file) =>
        file.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [files, search],
  );

  const filteredTrash = useMemo(
    () =>
      trashedFiles.filter((file) =>
        (file.name || file.originalName)
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [trashedFiles, search],
  );

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = folderName.trim();

    if (!name) {
      notify("Folder name cannot be empty.");
      return;
    }

    try {
      await createCloudFolder(name);
      await refreshCloudFiles();
      setFolderName("");
      setFolderDialog(false);
      notify(`Folder "${name}" created.`);
    } catch (error) {
      console.error("Failed to create folder:", error);
      notify("Couldn't create the folder. Please try again.");
    }
  }

  async function handleUploads(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selected = Array.from(input.files ?? []);
    input.value = "";

    if (selected.length === 0) return;

    const tooLarge = selected.filter((file) => file.size > 10 * 1024 * 1024);

    if (tooLarge.length > 0) {
      notify("Each file must be 10 MB or smaller.");
      return;
    }

    let uploaded = 0;

    for (const file of selected) {
      try {
        await uploadFile(file);
        uploaded += 1;
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
      }
    }

    await refreshCloudFiles();

    if (uploaded === selected.length) {
      notify(`${uploaded} file(s) uploaded successfully.`);
    } else {
      notify(
        `${uploaded} of ${selected.length} file(s) uploaded. Check the console for errors.`,
      );
    }
  }

    function choosePage(label: string) {
    setActivePage(label);
    setMobileMenu(false);
    setOpenMenuId(null);
    setSearch("");

    if (label === "Trash") {
      void refreshTrash();
      return;
    }

    if (label === "Shared Links") {
      void refreshShareLinks();
      return;
    }

    if (!["Dashboard", "My Files"].includes(label)) {
      notify(`${label} view is not connected to the backend yet.`);
    }
  }

  const displayName = user?.name?.trim() || user?.email || "there";
  const profileName = user?.name?.trim() || user?.email || "User";
  const isTrashPage = activePage === "Trash";
  const isSharedLinksPage = activePage === "Shared Links";
  const visibleFiles = filteredFiles;

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
                  Storage
                </div>
                <span className="text-xs font-semibold text-blue-700">24%</span>
              </div>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-xl font-bold text-slate-900">2.4 GB</span>
                <span className="text-xs text-slate-500">of 10 GB</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full w-[24%] rounded-full bg-blue-600" />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Your files are stored securely in your vault.
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
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  isTrashPage
                    ? "Search deleted files..."
                    : isSharedLinksPage
                      ? "Search share links..."
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

              <button
                onClick={() => notify("Account settings will be connected soon.")}
                className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-slate-50"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {(user?.name?.trim() || user?.email || "U")
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <span className="hidden max-w-40 truncate text-sm font-semibold sm:block">
                  {profileName}
                </span>
                <ChevronDown size={16} className="text-slate-400" />
              </button>
            </div>
          </header>

          <div className="mx-auto max-w-[1600px] p-4 md:p-8">
            <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-sm font-medium text-blue-600">
                  {isTrashPage ? "FILE RECOVERY" : isSharedLinksPage ? "LINK MANAGEMENT" : "YOUR PERSONAL CLOUD"}
                </p>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                  {pageTitle}
                </h1>
                <p className="mt-2 text-sm text-slate-500 md:text-base">
                  {isTrashPage
                    ? "Restore deleted files or permanently remove them from your vault."
                    : isSharedLinksPage
                      ? "Manage links you have created for your files."
                      : "Everything you need, organized in one secure place."}
                </p>
              </div>

              {!isTrashPage && !isSharedLinksPage && (
                <button
                  onClick={() => uploadRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
                >
                  <Upload size={18} />
                  Upload files
                </button>
              )}
            </div>

            {!isTrashPage && !isSharedLinksPage && (
              <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: "Total files",
                    value: String(files.filter((file) => file.type !== "Folder").length),
                    note: "In this preview",
                    icon: FileText,
                    color: "text-blue-600",
                    bg: "bg-blue-50",
                  },
                  {
                    label: "Folders",
                    value: String(files.filter((file) => file.type === "Folder").length),
                    note: "Keep things organized",
                    icon: Folder,
                    color: "text-violet-600",
                    bg: "bg-violet-50",
                  },
                  {
                    label: "Storage used",
                    value: "2.4 GB",
                    note: "24% of 10 GB",
                    icon: HardDrive,
                    color: "text-emerald-600",
                    bg: "bg-emerald-50",
                  },
                  {
                    label: "Shared items",
                    value: "—",
                    note: "Sharing summary not connected",
                    icon: Share2,
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
                isTrashPage || isSharedLinksPage ? "" : "2xl:grid-cols-[minmax(0,1fr)_320px]"
              }`}
            >
              <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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

                    {!isTrashPage && !isSharedLinksPage && (
                      <>
                        <button
                          onClick={() => uploadRef.current?.click()}
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

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            <th className="px-5 py-4">Name</th>
                            <th className="px-4 py-4">Date deleted</th>
                            <th className="px-4 py-4">Size</th>
                            <th className="px-4 py-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredTrash.map((file) => (
                            <tr key={file.id} className="group transition hover:bg-slate-50">
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
                      <div className="py-12 text-center text-sm text-slate-500">Loading share links…</div>
                    ) : shareLinks.length === 0 ? (
                      <div className="py-14 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Link2 size={26} /></div>
                        <p className="mt-4 font-semibold text-slate-800">No share links yet</p>
                        <p className="mt-2 text-sm text-slate-500">Create a link from a file’s action menu to share it securely.</p>
                        <button onClick={() => choosePage("My Files")} className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700">Browse files</button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {shareLinks.filter((link) => link.fileName.toLowerCase().includes(search.trim().toLowerCase())).map((link) => (
                          <div key={link.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="rounded-xl bg-blue-50 p-3 text-blue-600"><Link2 size={20} /></div>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-slate-800">{link.fileName}</p>
                                <p className="mt-1 text-xs text-slate-500">Created {formatDate(link.createdAt)}</p>
                                <p className="mt-1 text-xs text-slate-500">{link.revokedAt ? "Revoked" : link.expiresAt ? `Expires ${formatDate(link.expiresAt)}` : "Never expires"}</p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${link.revokedAt ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{link.revokedAt ? "Revoked" : "Active"}</span>
                              {!link.revokedAt && <button onClick={() => void handleRevokeShareLink(link.id)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={15} /> Revoke</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                                <td className="px-5 py-3.5">
                                  <button
                                    onClick={() => {
                                      if (file.type === "Folder") {
                                        notify("Opening folders is not connected yet.");
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
                                              file.mimeType === "application/pdf") && (
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
                                              onClick={() => void handleMoveToTrash(file.id, file.name)}
                                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                            >
                                              <Trash size={16} />
                                              Move to Trash
                                            </button>
                                          </>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              setOpenMenuId(null);
                                              notify("Folder-specific actions are not connected yet.");
                                            }}
                                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50"
                                          >
                                            <Folder size={16} />
                                            Folder actions
                                          </button>
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

                    {loading && (
                      <div className="px-5 py-10 text-center text-sm text-slate-500">
                        Loading your files…
                      </div>
                    )}

                    {!loading && !fileError && visibleFiles.length === 0 && (
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

                    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
                      <span className="text-xs text-slate-500">
                        Showing {visibleFiles.length} of {files.length} items
                      </span>
                      <button
                        onClick={() => choosePage("My Files")}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
                      >
                        View all files <ArrowRight size={16} />
                      </button>
                    </div>
                  </>
                )}
              </section>

              {!isTrashPage && !isSharedLinksPage && (
                <div className="space-y-6">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="font-bold text-slate-900">Quick actions</h2>
                    <p className="mt-1 text-sm text-slate-500">Get things done faster.</p>
                    <div className="mt-5 space-y-2">
                      <button
                        onClick={() => uploadRef.current?.click()}
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
                    <div className="mt-5 space-y-5">
                      {[
                        {
                          icon: Upload,
                          color: "text-emerald-600",
                          bg: "bg-emerald-50",
                          title: "Ready to upload",
                          subtitle: "Add your latest files",
                        },
                        {
                          icon: Folder,
                          color: "text-violet-600",
                          bg: "bg-violet-50",
                          title: "Keep files organized",
                          subtitle: "Create your first folders",
                        },
                        {
                          icon: Share2,
                          color: "text-blue-600",
                          bg: "bg-blue-50",
                          title: "Share with others",
                          subtitle: "Create a secure share link",
                        },
                      ].map(({ icon: Icon, color, bg, title, subtitle }) => (
                        <div key={title} className="flex items-center gap-3">
                          <span className={`rounded-xl p-2.5 ${bg} ${color}`}>
                            <Icon size={18} />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{title}</p>
                            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-lg shadow-blue-100">
                    <div className="flex items-center gap-2 text-blue-100">
                      <HardDrive size={19} />
                      <span className="text-sm font-medium">Your cloud storage</span>
                    </div>
                    <p className="mt-4 text-2xl font-bold">
                      2.4 GB{" "}
                      <span className="text-sm font-medium text-blue-100">/ 10 GB</span>
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
                      <div className="h-full w-[24%] rounded-full bg-white" />
                    </div>
                    <p className="mt-3 text-xs text-blue-100">
                      You're using 24% of your available storage.
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
                  {preview.mimeType === "application/pdf" ? "PDF preview" : "Image preview"}
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
              ) : (
                <iframe
                  src={preview.url}
                  title={`Preview of ${preview.name}`}
                  className="h-[78vh] w-full rounded-lg border border-slate-200 bg-white"
                />
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
          <div role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-blue-50 p-3 text-blue-600"><Share2 size={22} /></div>
                <div className="min-w-0">
                  <h2 id="share-dialog-title" className="text-lg font-bold text-slate-900">Share file</h2>
                  <p className="mt-1 break-words text-sm text-slate-500">Create a secure link for {shareDialogFile.name}.</p>
                </div>
              </div>
              <button onClick={() => { setShareDialogFile(null); setCreatedShareUrl(""); }} disabled={shareSubmitting} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50" aria-label="Close share dialog"><X size={20} /></button>
            </div>

            {!createdShareUrl ? (
              <>
                <label htmlFor="share-expiry" className="mb-2 block text-sm font-medium text-slate-700">Link expiration</label>
                <select id="share-expiry" value={shareExpiry} onChange={(event) => setShareExpiry(event.target.value)} disabled={shareSubmitting} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50">
                  <option value="never">Never expires</option>
                  <option value="1">Expires in 1 day</option>
                  <option value="7">Expires in 7 days</option>
                  <option value="30">Expires in 30 days</option>
                </select>
                <p className="mt-3 text-xs leading-5 text-slate-500">Anyone with this link can access the shared file until the link expires or is revoked.</p>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => setShareDialogFile(null)} disabled={shareSubmitting} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                  <button type="button" onClick={() => void handleCreateShareLink()} disabled={shareSubmitting} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"><Link2 size={16} />{shareSubmitting ? "Creating link…" : "Create link"}</button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} /> Share link created</div><p className="mt-1 text-xs leading-5">Copy the link now. For security, the token is only returned when the link is created.</p></div>
                <label htmlFor="created-share-url" className="mb-2 mt-5 block text-sm font-medium text-slate-700">Share URL</label>
                <input id="created-share-url" readOnly value={createdShareUrl} onFocus={(event) => event.currentTarget.select()} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none" />
                <div className="mt-5 flex justify-end gap-3">
                  <button type="button" onClick={() => { setShareDialogFile(null); setCreatedShareUrl(""); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Done</button>
                  <button type="button" onClick={() => void handleCopyShareUrl()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Copy size={16} /> Copy link</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
