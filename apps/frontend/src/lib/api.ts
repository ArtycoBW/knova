import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("accessToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      const refreshToken =
        typeof window !== "undefined"
          ? localStorage.getItem("refreshToken")
          : null;

      if (!refreshToken) {
        redirectToLogin();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
          { refreshToken },
        );
        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);
        document.cookie = `accessToken=${data.accessToken}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        redirectToLogin();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

function redirectToLogin() {
  if (typeof window !== "undefined") {
    const path = `${window.location.pathname}${window.location.search}`;
    const isAuthPage = ["/login", "/register", "/reset-password"].some((p) =>
      window.location.pathname.startsWith(p),
    );
    if (!isAuthPage) {
      window.location.href = `/login?redirect=${encodeURIComponent(path)}`;
    }
  }
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const msg = error.response?.data?.message;
    if (Array.isArray(msg)) return msg.join(", ");
    if (typeof msg === "string") return msg;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Неизвестная ошибка";
}
