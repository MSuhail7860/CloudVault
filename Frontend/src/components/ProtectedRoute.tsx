import { useEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";
import { getCurrentUser, type User } from "../lib/auth";
import { tokenStorage } from "../lib/api";

export interface ProtectedRouteContext {
  user: User;
  updateUser: (user: User) => void;
}

export default function ProtectedRoute() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const location = useLocation();

  useEffect(() => {
    let active = true;

    async function verifySession() {
      const accessToken = tokenStorage.getAccessToken();
      const refreshToken = tokenStorage.getRefreshToken();

      if (!accessToken && !refreshToken) {
        if (active) setChecking(false);
        return;
      }

      try {
        const currentUser = await getCurrentUser();

        if (active) {
          setUser(currentUser);
        }
      } catch {
        tokenStorage.clear();

        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    }

    void verifySession();

    return () => {
      active = false;
    };
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">
          Verifying your session...
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location }}
      />
    );
  }

  return (
    <Outlet
      context={{
        user,
        updateUser: (updatedUser: User) => setUser(updatedUser),
      }}
    />
  );
}
