import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  LockKeyhole,
  Mail,
  Save,
  ShieldAlert,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  changePassword,
  deleteCurrentAccount,
  resendEmailVerification,
  updateCurrentUser,
} from "../lib/auth";
import { tokenStorage } from "../lib/api";
import type { ProtectedRouteContext } from "../components/ProtectedRoute";

const MAX_NAME_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback;
  }

  return fallback;
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export default function AccountSettingsPage() {
  const navigate = useNavigate();
  const { user, updateUser } = useOutletContext<ProtectedRouteContext>();

  const [name, setName] = useState(user.name ?? "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState("");
  const [verificationCooldown, setVerificationCooldown] = useState(0);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const [deletionDialogOpen, setDeletionDialogOpen] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [deletionError, setDeletionError] = useState("");

  useEffect(() => {
    if (verificationCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setVerificationCooldown((remaining) => remaining - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [verificationCooldown]);

  async function handleResendVerification() {
    setVerificationLoading(true);
    setVerificationNotice("");
    try {
      await resendEmailVerification(user.email);
      setVerificationNotice(
        "If your account needs verification, a message will be sent.",
      );
      setVerificationCooldown(60);
    } catch (error) {
      setVerificationNotice(
        getErrorMessage(error, "Unable to request a verification message."),
      );
    } finally {
      setVerificationLoading(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    setProfileSuccess("");

    const normalizedName = name.trim();

    if (!normalizedName) {
      setProfileError("Name cannot be empty.");
      return;
    }

    if (normalizedName.length > MAX_NAME_LENGTH) {
      setProfileError(`Name cannot exceed ${MAX_NAME_LENGTH} characters.`);
      return;
    }

    setProfileLoading(true);

    try {
      const updatedUser = await updateCurrentUser(normalizedName);
      updateUser(updatedUser);
      setName(updatedUser.name ?? "");
      setProfileSuccess("Your profile was updated successfully.");
    } catch (error) {
      setProfileError(
        getErrorMessage(
          error,
          "Unable to update your profile. Please try again.",
        ),
      );
    } finally {
      setProfileLoading(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Complete all password fields before continuing.");
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `New password must contain at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }

    if (getUtf8ByteLength(newPassword) > MAX_PASSWORD_BYTES) {
      setPasswordError(
        `New password cannot exceed ${MAX_PASSWORD_BYTES} bytes.`,
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setPasswordLoading(true);

    try {
      await changePassword({ currentPassword, newPassword });

      // Password changes revoke every refresh token, including this session.
      // Clear both local tokens before returning to the public login flow.
      tokenStorage.clear();
      navigate("/login", {
        replace: true,
        state: { passwordChanged: true },
      });
    } catch (error) {
      setPasswordError(
        getErrorMessage(
          error,
          "Unable to change your password. Please try again.",
        ),
      );
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleAccountDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeletionError("");

    if (!deletionPassword) {
      setDeletionError("Enter your current password to continue.");
      return;
    }

    if (!deletionConfirmed) {
      setDeletionError(
        "Confirm that you understand account deletion is permanent.",
      );
      return;
    }

    setDeletionLoading(true);

    try {
      const responseStatus = await deleteCurrentAccount(deletionPassword);

      if (responseStatus !== 202) {
        throw new Error("Account deletion was not scheduled.");
      }

      tokenStorage.clear();
      navigate("/login", {
        replace: true,
        state: { accountDeletionScheduled: true },
      });
    } catch (error) {
      setDeletionError(
        getErrorMessage(
          error,
          "Unable to schedule account deletion. Please try again.",
        ),
      );
    } finally {
      setDeletionLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 md:px-8">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200">
              <Cloud size={25} />
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Cloud<span className="text-blue-600">Vault</span>
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8 md:py-14">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-blue-600">
            Account
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Account Settings
          </h1>
          <p className="mt-2 max-w-2xl text-slate-500">
            Manage your profile details and keep your CloudVault account secure.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="mb-6 flex items-start gap-4">
              <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                <UserRound size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Profile</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Update the display name shown across your workspace.
                </p>
              </div>
            </div>

            {profileError && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              >
                {profileError}
              </div>
            )}

            {profileSuccess && (
              <div
                role="status"
                className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"
              >
                <CheckCircle2 size={17} />
                {profileSuccess}
              </div>
            )}

            <form onSubmit={handleProfileSubmit} className="space-y-5">
              <div
                className={`rounded-xl border p-4 ${
                  user.emailVerifiedAt
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <p className="text-sm font-semibold text-slate-800">
                  Email {user.emailVerifiedAt ? "verified" : "not verified"}
                </p>
                {!user.emailVerifiedAt && (
                  <>
                    <p className="mt-1 text-sm text-slate-600">
                      Verify your email to use restricted file sharing.
                    </p>
                    {verificationNotice && (
                      <p className="mt-2 text-sm text-slate-600" role="status">
                        {verificationNotice}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleResendVerification()}
                      disabled={verificationLoading || verificationCooldown > 0}
                      className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {verificationLoading
                        ? "Requesting…"
                        : verificationCooldown > 0
                          ? `Try again in ${verificationCooldown}s`
                          : "Resend verification email"}
                    </button>
                  </>
                )}
              </div>
              <div>
                <label
                  htmlFor="account-name"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Display name
                </label>
                <input
                  id="account-name"
                  type="text"
                  autoComplete="name"
                  maxLength={MAX_NAME_LENGTH}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                />
                <p className="mt-2 text-xs text-slate-400">
                  Up to {MAX_NAME_LENGTH} characters.
                </p>
              </div>

              <div>
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Email address
                </span>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  <Mail size={17} className="text-slate-400" />
                  <span className="truncate">{user.email}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Email changes are not available yet.
                </p>
              </div>

              <button
                type="submit"
                disabled={profileLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={17} />
                {profileLoading ? "Saving…" : "Save profile"}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="mb-6 flex items-start gap-4">
              <div className="rounded-xl bg-violet-50 p-3 text-violet-600">
                <LockKeyhole size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Password</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Change your password and sign in again on this device.
                </p>
              </div>
            </div>

            {passwordError && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              >
                {passwordError}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="current-password"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Current password
                </label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                />
              </div>

              <div>
                <label
                  htmlFor="new-password"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                />
                <p className="mt-2 text-xs text-slate-400">
                  At least {MIN_PASSWORD_LENGTH} characters and no more than {MAX_PASSWORD_BYTES} UTF-8 bytes.
                </p>
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                />
              </div>

              <button
                type="submit"
                disabled={passwordLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LockKeyhole size={17} />
                {passwordLoading ? "Changing password…" : "Change password"}
              </button>
            </form>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm md:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-rose-100 p-3 text-rose-600">
              <ShieldAlert size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-rose-950">Danger Zone</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-rose-800">
                Deleting your account is permanent. CloudVault will remove your
                stored files, file versions, shares, activity history, and
                related account data after the deletion is scheduled.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDeletionError("");
                  setDeletionDialogOpen(true);
                }}
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-100"
              >
                <Trash2 size={17} />
                Delete account
              </button>
            </div>
          </div>
        </section>
      </div>

      {deletionDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletionLoading) {
              setDeletionDialogOpen(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl md:p-8"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-rose-100 p-3 text-rose-600">
                <Trash2 size={21} />
              </div>
              <div>
                <h2
                  id="delete-account-title"
                  className="text-xl font-bold text-slate-900"
                >
                  Permanently delete account?
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This action permanently removes your account and stored data.
                  Deletion is scheduled in the background and cannot be undone.
                </p>
              </div>
            </div>

            {deletionError && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              >
                {deletionError}
              </div>
            )}

            <form onSubmit={handleAccountDeletion} className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="delete-current-password"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Current password
                </label>
                <input
                  id="delete-current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={deletionPassword}
                  onChange={(event) => setDeletionPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-50"
                />
              </div>

              <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                <input
                  type="checkbox"
                  checked={deletionConfirmed}
                  onChange={(event) => setDeletionConfirmed(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span>
                  I understand that account deletion is permanent and cannot be
                  undone.
                </span>
              </label>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={deletionLoading}
                  onClick={() => setDeletionDialogOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deletionLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 size={17} />
                  {deletionLoading ? "Scheduling deletion…" : "Delete my account"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
