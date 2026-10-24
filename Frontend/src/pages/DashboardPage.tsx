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
  type CloudFile,
  type CloudFolder,
} from "../lib/files";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ChevronDown,
  Clock3,
  Cloud,
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
  Search,
  Settings,
  Share2,
  Trash2,
  Upload,
  Users,
  X,
  Plus,
  ArrowRight,
  CheckCircle2,
  Download,
  Pencil,
  Trash,
} from "lucide-react";

type FileItem = {
  id: string;
  name: string;
  type: string;
  modified: string;
  size: string;
  icon: LucideIcon;
  color: string;
  bg: string;
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
  const uploadRef = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  function notify(message: string) {
    setNotice(message);

    if (noticeTimer.current !== undefined) {
      window.clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      noticeTimer.current = undefined;
    }, 3000);
  }

  async function refreshCloudFiles() {
    try {
      const [cloudFiles, cloudFolders] = await Promise.all([
        listFiles(),
        listFolders(),
      ]);

      const formatDate = (value: string) =>
        new Date(value).toLocaleString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

      const formatSize = (value: string) => {
        const bytes = Number(value);

        if (!Number.isFinite(bytes) || bytes < 0) return "—";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) {
          return `${(bytes / 1024).toFixed(1)} KB`;
        }
        if (bytes < 1024 * 1024 * 1024) {
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }

        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      };

      const mapFile = (file: CloudFile): FileItem => {
        const name = file.name || file.originalName;
        const isImage = file.mimeType.startsWith("image/");
        const isPdf = file.mimeType === "application/pdf";

        return {
          id: file.id,
          name,
          type: isImage ? "Image" : isPdf ? "PDF Document" : "File",
          modified: formatDate(file.updatedAt || file.createdAt),
          size: formatSize(file.size),
          icon: isImage ? FileImage : isPdf ? FileText : File,
          color: isImage
            ? "text-teal-600"
            : isPdf
              ? "text-red-500"
              : "text-blue-600",
          bg: isImage
            ? "bg-teal-50"
            : isPdf
              ? "bg-red-50"
              : "bg-blue-50",
        };
      };

      const mapFolder = (folder: CloudFolder): FileItem => ({
        id: folder.id,
        name: folder.name,
        type: "Folder",
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
      notify(
        "Couldn't load files. Check that the backend is running and you're signed in.",
      );
    } finally {
      setLoading(false);
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

  async function handleRename(fileId: string, currentName: string) {
    setOpenMenuId(null);

    const enteredName = window.prompt(
      "Enter the new file name:",
      currentName,
    );

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

  async function handleMoveToTrash(fileId: string, fileName: string) {
    setOpenMenuId(null);

    const confirmed = window.confirm(
      `Move "${fileName}" to Trash?`,
    );

    if (!confirmed) return;

    try {
      await moveFileToTrash(fileId);
      await refreshCloudFiles();
      notify(`Moved "${fileName}" to Trash.`);
    } catch (error) {
      console.error(`Failed to move ${fileName} to Trash:`, error);
      notify("Couldn't move the file to Trash. Please try again.");
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

  const filteredFiles = useMemo(
    () =>
      files.filter((file) =>
        file.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [files, search],
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

    const tooLarge = selected.filter(
      (file) => file.size > 10 * 1024 * 1024,
    );

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

    if (label !== "Dashboard" && label !== "My Files") {
      notify(`${label} view is not connected yet.`);
    }
  }

  const displayName = user?.name?.trim() || user?.email || "there";
  const profileName = user?.name?.trim() || user?.email || "User";

  const pageTitle =
    activePage === "Dashboard"
      ? `Good to see you, ${displayName}!`
      : activePage;

  const visibleFiles =
    activePage === "My Files"
      ? filteredFiles
      : filteredFiles;

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
          className="fixed right-5 top-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
        >
          <CheckCircle2
            size={18}
            className="shrink-0 text-emerald-400"
          />
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
                <span className="text-xs font-semibold text-blue-700">
                  24%
                </span>
              </div>

              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-xl font-bold text-slate-900">
                  2.4 GB
                </span>
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
                placeholder="Search files and folders..."
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
                onClick={() =>
                  notify("Account settings will be connected soon.")
                }
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
                  YOUR PERSONAL CLOUD
                </p>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                  {pageTitle}
                </h1>
                <p className="mt-2 text-sm text-slate-500 md:text-base">
                  Everything you need, organized in one secure place.
                </p>
              </div>

              <button
                onClick={() => uploadRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
              >
                <Upload size={18} />
                Upload files
              </button>
            </div>

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
                    <span className="text-sm font-medium text-slate-500">
                      {label}
                    </span>
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

            <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
              <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {activePage === "Dashboard"
                        ? "Recent files"
                        : activePage}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {search
                        ? `${visibleFiles.length} matching items`
                        : "Your files and folders at a glance"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
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
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px] text-left">
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
                      {visibleFiles.map(
                        ({
                          id,
                          name,
                          type,
                          modified,
                          size,
                          icon: Icon,
                          color,
                          bg,
                        }) => (
                          <tr
                            key={id}
                            className="group transition hover:bg-slate-50"
                          >
                            <td className="px-5 py-3.5">
                              <button
                                onClick={() =>
                                  notify(
                                    type === "Folder"
                                      ? `${name} is a folder. Opening folders is not connected yet.`
                                      : `Selected ${name}.`,
                                  )
                                }
                                className="flex items-center gap-3 text-left"
                              >
                                <span
                                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg} ${color}`}
                                >
                                  <Icon size={21} />
                                </span>

                                <span>
                                  <span className="block max-w-[230px] truncate text-sm font-semibold text-slate-800">
                                    {name}
                                  </span>
                                  <span className="mt-1 block text-xs text-slate-400">
                                    {type}
                                  </span>
                                </span>
                              </button>
                            </td>

                            <td className="px-4 py-3.5 text-sm text-slate-500">
                              {modified}
                            </td>

                            <td className="px-4 py-3.5 text-sm text-slate-500">
                              {size}
                            </td>

                            <td className="px-4 py-3.5">
                              <div className="relative">
                                <button
                                  onClick={() =>
                                    setOpenMenuId((current) =>
                                      current === id ? null : id,
                                    )
                                  }
                                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                  aria-label={`More actions for ${name}`}
                                  aria-expanded={openMenuId === id}
                                >
                                  <MoreVertical size={18} />
                                </button>

                                {openMenuId === id && (
                                  <div className="absolute right-0 top-full z-20 mt-1 min-w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                                    {type !== "Folder" ? (
                                      <>
                                        <button
                                          onClick={() =>
                                            void handleDownload(id, name)
                                          }
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                          <Download size={16} />
                                          Download
                                        </button>

                                        <button
                                          onClick={() =>
                                            void handleRename(id, name)
                                          }
                                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                          <Pencil size={16} />
                                          Rename
                                        </button>

                                        <button
                                          onClick={() =>
                                            void handleMoveToTrash(id, name)
                                          }
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
                                          notify(
                                            "Folder rename and folder actions are not connected yet.",
                                          );
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
                        ),
                      )}
                    </tbody>
                  </table>
                </div>

                {loading && (
                  <div className="px-5 py-10 text-center text-sm text-slate-500">
                    Loading your files…
                  </div>
                )}

                {!loading && visibleFiles.length === 0 && (
                  <div className="px-5 py-14 text-center">
                    <Search size={28} className="mx-auto text-slate-300" />
                    <p className="mt-3 font-semibold text-slate-700">
                      No files found
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Try another search term or upload a file.
                    </p>
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
              </section>

              <div className="space-y-6">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-bold text-slate-900">Quick actions</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Get things done faster.
                  </p>

                  <div className="mt-5 space-y-2">
                    <button
                      onClick={() => uploadRef.current?.click()}
                      className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-blue-50"
                    >
                      <span className="rounded-xl bg-blue-50 p-3 text-blue-600">
                        <Upload size={20} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">
                          Upload files
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Add files to your vault
                        </span>
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
                        <span className="block text-sm font-semibold">
                          Create folder
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Organize your files
                        </span>
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
                        <span className="block text-sm font-semibold">
                          Shared links
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Manage shared files
                        </span>
                      </span>
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold text-slate-900">
                      Recent activity
                    </h2>
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
                          <p className="text-sm font-semibold text-slate-700">
                            {title}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {subtitle}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-lg shadow-blue-100">
                  <div className="flex items-center gap-2 text-blue-100">
                    <HardDrive size={19} />
                    <span className="text-sm font-medium">
                      Your cloud storage
                    </span>
                  </div>

                  <p className="mt-4 text-2xl font-bold">
                    2.4 GB{" "}
                    <span className="text-sm font-medium text-blue-100">
                      / 10 GB
                    </span>
                  </p>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full w-[24%] rounded-full bg-white" />
                  </div>

                  <p className="mt-3 text-xs text-blue-100">
                    You're using 24% of your available storage.
                  </p>
                </section>
              </div>
            </div>

            <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-slate-200 py-5 text-xs text-slate-400 sm:flex-row">
              <span>© 2026 CloudVault · Your files, your space.</span>
              <span>Secure cloud storage · MVP Preview</span>
            </footer>
          </div>
        </main>
      </div>

      {folderDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setFolderDialog(false);
            }
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
                  <h2
                    id="folder-dialog-title"
                    className="text-lg font-bold text-slate-900"
                  >
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
              <label
                htmlFor="folder-name"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
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
    </div>
  );
}
