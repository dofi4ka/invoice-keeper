import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, invalidate, setBearerToken, setUnauthorizedHandler } from "./api";
import type { Me } from "./types";

/** Signed launch data Telegram puts into the URL hash when the panel is opened as the bot's Mini App. */
const telegramInitData = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData");

interface AuthState {
  user: Me | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    const telegram = telegramInitData
      ? api<{ token: string; user: Me }>("/auth/telegram", { method: "POST", json: { init_data: telegramInitData } }).then((r) => {
          setBearerToken(r.token);
          return r.user;
        })
      : Promise.reject();
    // outside Telegram, or with a Telegram ID unknown to the panel, the usual session applies
    telegram
      .catch(() => api<Me>("/auth/me"))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api<{ token: string; user: Me }>("/auth/login", { method: "POST", json: { email, password } });
    if (telegramInitData) setBearerToken(result.token);
    invalidate();
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setBearerToken(null);
      setUser(null);
    }
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** The signed-in user; only used inside the authenticated layout. */
export function useMe(): Me {
  return useContext(AuthContext).user!;
}
