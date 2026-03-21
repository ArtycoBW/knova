"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let currentToken: string | null = null;

function getBaseUrl() {
  const explicitWsUrl = (process.env.NEXT_PUBLIC_WS_URL || "").replace(/\/$/, "");
  if (explicitWsUrl) {
    return explicitWsUrl;
  }

  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/$/, "");
  }

  return (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
}

export function getRealtimeSocket() {
  if (typeof window === "undefined") {
    return null;
  }

  const token = localStorage.getItem("accessToken");
  const url = getBaseUrl();

  if (!token || !url) {
    return null;
  }

  if (!socket || currentToken !== token) {
    socket?.disconnect();
    currentToken = token;
    socket = io(url, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
}

export function disconnectRealtimeSocket() {
  socket?.disconnect();
  socket = null;
  currentToken = null;
}
