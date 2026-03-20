"use client";

export function Footer() {
  return (
    <footer className="border-t border-border/50 py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">K</span>
          </div>
          <span
            className="font-semibold"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Knova
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          © 2026 Knova. Хакатон Центр-Инвест.
        </p>
      </div>
    </footer>
  );
}
