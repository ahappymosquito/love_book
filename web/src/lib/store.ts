"use client";

import { create } from "zustand";
import type { MeOut } from "./types";

const TOKEN_KEY = "pair-events-token";
const ADMIN_VERIFIED_KEY = "pair-events-admin-verified";

interface AppState {
  token: string | null;
  me: MeOut | null;
  adminKey: string | null;
  hydrated: boolean;
  setToken: (token: string | null) => void;
  setMe: (me: MeOut | null) => void;
  setAdminKey: (key: string | null) => void;
  logout: () => void;
  logoutAdmin: () => void;
  hydrate: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  token: null,
  me: null,
  adminKey: null,
  hydrated: false,

  setToken: (token) => {
    if (typeof window !== "undefined") {
      if (token) {
        window.localStorage.setItem(TOKEN_KEY, token);
      } else {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    }
    set({ token });
    if (!token) set({ me: null });
  },

  setMe: (me) => set({ me }),

  setAdminKey: (key) => {
    if (typeof window !== "undefined") {
      if (key) {
        window.sessionStorage.setItem(ADMIN_VERIFIED_KEY, "1");
      } else {
        window.sessionStorage.removeItem(ADMIN_VERIFIED_KEY);
      }
    }
    set({ adminKey: key });
  },

  logout: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
    }
    set({ token: null, me: null });
  },

  logoutAdmin: () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(ADMIN_VERIFIED_KEY);
    }
    set({ adminKey: null });
  },

  hydrate: () => {
    if (typeof window === "undefined") return;
    const token = window.localStorage.getItem(TOKEN_KEY);
    set({ token: token || null, hydrated: true });
  },
}));

export function isAdminPreVerified(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(ADMIN_VERIFIED_KEY) === "1";
}
