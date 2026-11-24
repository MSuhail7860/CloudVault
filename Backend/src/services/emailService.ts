import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface VerificationEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const capturedMessages: VerificationEmail[] = [];

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });

const createVerificationUrl = (token: string): URL => {
  const configuredOrigin =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!configuredOrigin) {
    throw new Error("FRONTEND_URL is required to send verification emails");
  }

  let url: URL;
  try {
    url = new URL(configuredOrigin);
  } catch {
    throw new Error("FRONTEND_URL is invalid");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  ) {
    throw new Error("FRONTEND_URL must be a secure web origin");
  }

  const verificationUrl = new URL("/verify-email", url.origin);
  verificationUrl.hash = new URLSearchParams({ token }).toString();
  return verificationUrl;
};

const createMessage = (email: string, token: string): VerificationEmail => {
  const verificationUrl = createVerificationUrl(token).toString();
  const safeUrl = escapeHtml(verificationUrl);
  return {
    to: email,
    subject: "Verify your CloudVault email",
    text: `Verify your CloudVault email address by opening this link: ${verificationUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your CloudVault email address.</p><p><a href="${safeUrl}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  };
};

const sendWithResend = async (message: VerificationEmail): Promise<void> => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("Email delivery is not configured");
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Verification email delivery failed");
  }

  if (!response.ok) {
    throw new Error("Verification email delivery failed");
  }
};

const captureForDevelopment = async (
  message: VerificationEmail,
): Promise<void> => {
  if (process.env.NODE_ENV === "test") {
    capturedMessages.push(message);
    return;
  }

  const directory = resolve(
    process.env.EMAIL_CAPTURE_DIRECTORY?.trim() || ".mail-capture",
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = resolve(directory, `${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(message, null, 2), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
};

export const sendVerificationEmail = async (
  email: string,
  token: string,
): Promise<void> => {
  const message = createMessage(email, token);
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();

  if (provider === "resend") {
    await sendWithResend(message);
    return;
  }

  if (!provider && process.env.NODE_ENV !== "production") {
    await captureForDevelopment(message);
    return;
  }

  throw new Error("Email delivery provider is not configured");
};

export const takeCapturedVerificationEmails = (): VerificationEmail[] =>
  capturedMessages.splice(0, capturedMessages.length);

export const assertEmailDeliveryConfiguration = (): void => {
  if (process.env.NODE_ENV !== "production") return;
  if (
    process.env.EMAIL_PROVIDER?.trim().toLowerCase() !== "resend" ||
    !process.env.RESEND_API_KEY?.trim() ||
    !process.env.EMAIL_FROM?.trim()
  ) {
    throw new Error("Production email delivery is not configured");
  }
  createVerificationUrl("configuration-check");
};
