import axios, {
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:8000/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

const ACCESS_TOKEN_KEY = "cloudvault_access_token";
const REFRESH_TOKEN_KEY = "cloudvault_refresh_token";

export const tokenStorage = {
  getAccessToken: () => sessionStorage.getItem(ACCESS_TOKEN_KEY),
  getRefreshToken: () => sessionStorage.getItem(REFRESH_TOKEN_KEY),

  setTokens: (accessToken: string, refreshToken: string) => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },

  setAccessToken: (accessToken: string) => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  },

  clear: () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// Attach the current access token to outgoing requests.
api.interceptors.request.use((config) => {
  const accessToken = tokenStorage.getAccessToken();

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

interface RefreshResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
  };
}

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

// Share one refresh request between concurrent failed requests.
let refreshPromise: Promise<string> | null = null;

async function requestNewAccessToken(): Promise<string> {
  const refreshToken = tokenStorage.getRefreshToken();

  if (!refreshToken) {
    throw new Error("No refresh token available.");
  }

  // Use raw axios to prevent the refresh request from triggering
  // the same response interceptor recursively.
  const response = await axios.post<RefreshResponse>(
    `${API_BASE_URL.replace(/\/+$/, "")}/auth/refresh`,
    { refreshToken },
  );

  const {
    accessToken,
    refreshToken: newRefreshToken,
  } = response.data.data;

  tokenStorage.setTokens(accessToken, newRefreshToken);

  return accessToken;
}

// Automatically refresh expired access tokens.
api.interceptors.response.use(
  (response) => response,

  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
    }

    const originalRequest =
      error.config as RetryableRequestConfig | undefined;

    if (!originalRequest || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    const requestUrl = originalRequest.url ?? "";

    // Never retry authentication endpoints.
    const isAuthEndpoint = [
      "/auth/login",
      "/auth/register",
      "/auth/refresh",
      "/auth/logout",
      "/auth/verification/resend",
      "/auth/verification/verify",
    ].some((endpoint) => requestUrl.includes(endpoint));

    if (isAuthEndpoint || originalRequest._retry) {
      return Promise.reject(error);
    }

    const currentAccessToken = tokenStorage.getAccessToken();

    const requestAuthorization = AxiosHeaders.from(
      originalRequest.headers,
    ).get("Authorization");

    // Another request may already have refreshed the token.
    // Retry with the latest token instead of refreshing again.
    if (
      currentAccessToken &&
      requestAuthorization !== `Bearer ${currentAccessToken}`
    ) {
      originalRequest._retry = true;

      originalRequest.headers = AxiosHeaders.from(
        originalRequest.headers,
      );

      originalRequest.headers.set(
        "Authorization",
        `Bearer ${currentAccessToken}`,
      );

      return api(originalRequest);
    }

    originalRequest._retry = true;

    if (!tokenStorage.getRefreshToken()) {
      tokenStorage.clear();
      return Promise.reject(error);
    }

    // Start a refresh only if one is not already running.
    if (!refreshPromise) {
      refreshPromise = requestNewAccessToken().finally(() => {
        refreshPromise = null;
      });
    }

    let newAccessToken: string;

    try {
      newAccessToken = await refreshPromise;
    } catch (refreshError) {
      tokenStorage.clear();
      return Promise.reject(refreshError);
    }

    // Retry the original request with the new access token.
    originalRequest.headers = AxiosHeaders.from(
      originalRequest.headers,
    );

    originalRequest.headers.set(
      "Authorization",
      `Bearer ${newAccessToken}`,
    );

    return api(originalRequest);
  },
);
