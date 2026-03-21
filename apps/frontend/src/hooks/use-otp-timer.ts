"use client";

import { useEffect, useState } from "react";

export function useOtpTimer(duration = 60) {
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(0);
      return;
    }

    const update = () => {
      const next = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(next);
      if (next === 0) {
        setExpiresAt(null);
      }
    };

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [expiresAt]);

  return {
    secondsLeft,
    isActive: secondsLeft > 0,
    restart: () => setExpiresAt(Date.now() + duration * 1000),
  };
}
