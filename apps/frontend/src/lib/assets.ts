export function resolveAvatarUrl(avatarUrl: string | null | undefined) {
  if (!avatarUrl) {
    return null;
  }

  try {
    const parsed = new URL(avatarUrl);

    if (
      typeof window !== "undefined" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return `${window.location.origin}${parsed.pathname}`;
    }

    return parsed.toString();
  } catch {
    return avatarUrl;
  }
}
