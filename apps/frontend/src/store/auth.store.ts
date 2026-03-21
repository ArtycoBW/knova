import { create } from "zustand";

interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  role: string;
  avatarUrl: string | null;
  xp: number;
  level: number;
  onboardingDone: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  initFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,

  setAuth: (user, accessToken, refreshToken) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
    }
    set({ user, accessToken, isAuthenticated: true });
  },

  setUser: (user) => set({ user }),

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    }
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  initFromStorage: () => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("accessToken");
      if (token) {
        set({ accessToken: token, isAuthenticated: true });
      }
    }
  },
}));
