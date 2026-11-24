import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { CheckCircle2, Cloud, Mail, XCircle } from "lucide-react";
import { verifyEmail } from "../lib/auth";

export default function VerifyEmailPage() {
  const [token] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    return searchParams.get("token") ?? hashParams.get("token");
  });
  const [status, setStatus] = useState<"ready" | "loading" | "success" | "error">(
    token ? "ready" : "error",
  );
  const [message, setMessage] = useState(
    token
      ? "Confirm ownership of your email and choose a password for this account."
      : "This verification link is incomplete.",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    window.history.replaceState(null, "", "/verify-email");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      setStatus("error");
      setMessage("Password must contain at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("loading");
    setMessage("Verifying your email address…");
    try {
      await verifyEmail(token, password);
      setStatus("success");
      setMessage("Your email address is verified. You can now sign in.");
    } catch (error: unknown) {
      const apiMessage = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : undefined;
      setStatus("error");
      setMessage(
        apiMessage ?? "This verification link is invalid or has expired.",
      );
    }
  }

  /* The password is deliberately set only after proving control of the email. */
  const verificationForm = token && status !== "success";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
        <Link to="/" className="mb-8 inline-flex items-center gap-3">
          <span className="rounded-xl bg-blue-600 p-2.5">
            <Cloud size={24} />
          </span>
          <span className="text-xl font-bold">CloudVault</span>
        </Link>
        <div className="mb-5 flex justify-center">
          {status === "success" ? (
            <CheckCircle2 className="text-emerald-400" size={42} />
          ) : status === "error" ? (
            <XCircle className="text-rose-400" size={42} />
          ) : status === "loading" ? (
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-blue-400" />
          ) : (
            <Mail className="text-blue-400" size={42} />
          )}
        </div>
        <h1 className="text-2xl font-bold">
          {status === "success"
            ? "Email verified"
            : status === "error"
              ? "Verification unavailable"
              : status === "loading"
                ? "Verifying email"
                : "Verify your email"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300" role="status">
          {message}
        </p>
        {verificationForm && status !== "loading" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
            <label className="block text-sm">
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold hover:bg-blue-500"
            >
              Verify email and set password
            </button>
          </form>
        )}
        {status === "success" && (
          <Link
            to="/login"
            className="mt-7 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold hover:bg-blue-500"
          >
            Continue to sign in
          </Link>
        )}
      </section>
    </main>
  );
}
