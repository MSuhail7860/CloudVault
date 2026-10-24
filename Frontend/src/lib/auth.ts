import { api, tokenStorage } from "./api";

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

interface TokenResult {
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  const response = await api.post<ApiResponse<User>>(
    "/auth/register",
    input,
  );

  return response.data.data;
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<User> {
  const response = await api.post<ApiResponse<AuthResult>>(
    "/auth/login",
    input,
  );

  const { user, accessToken, refreshToken } = response.data.data;

  tokenStorage.setTokens(accessToken, refreshToken);

  return user;
}

export async function getCurrentUser(): Promise<User> {
  const response = await api.get<ApiResponse<User>>("/auth/me");

  return response.data.data;
}

export async function refreshSession(): Promise<void> {
  const refreshToken = tokenStorage.getRefreshToken();

  if (!refreshToken) {
    throw new Error("No refresh token available.");
  }

  const response = await api.post<ApiResponse<TokenResult>>(
    "/auth/refresh",
    { refreshToken },
  );

  tokenStorage.setTokens(
    response.data.data.accessToken,
    response.data.data.refreshToken,
  );
}

export async function logoutUser(): Promise<void> {
  const refreshToken = tokenStorage.getRefreshToken();

  try {
    if (refreshToken) {
      await api.post("/auth/logout", { refreshToken });
    }
  } finally {
    tokenStorage.clear();
  }
}
