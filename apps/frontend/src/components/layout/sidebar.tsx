"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  GitFork,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Mic,
  Presentation,
  Search,
  Settings,
  Table2,
  BarChart2,
  CheckSquare,
} from "lucide-react";
import { useLogout } from "@/hooks/use-auth";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { XpBar } from "@/components/ui/xp-bar";
import { useKnovaOnboarding } from "@/providers/nextstep-provider";

const NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Главная", tour: "dashboard" },
  { href: "/workspaces", icon: FolderOpen, label: "Воркспейсы" },
  { href: "/chat", icon: MessageSquare, label: "Чат", tour: "chat-button" },
  { href: "/mindmap", icon: GitFork, label: "Карта знаний", tour: "mindmap-button" },
  { href: "/podcast", icon: Mic, label: "Подкасты", tour: "podcast-button" },
  { href: "/quiz", icon: CheckSquare, label: "Тесты" },
  { href: "/reports", icon: FileText, label: "Отчёты" },
  { href: "/infographic", icon: BarChart2, label: "Инфографика" },
  { href: "/table", icon: Table2, label: "Таблицы" },
  { href: "/presentation", icon: Presentation, label: "Презентации" },
  { href: "/settings", icon: Settings, label: "Настройки" },
  { href: "/help", icon: HelpCircle, label: "Помощь" },
];

const HARD_NAVIGATION = new Set([
  "/chat",
  "/mindmap",
  "/podcast",
  "/quiz",
  "/reports",
  "/infographic",
  "/table",
  "/presentation",
]);

function LogoMark() {
  return (
    <motion.div
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4, ease: "backOut" }}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-md shadow-primary/30"
    >
      <span className="font-[Syne] text-base font-bold text-primary-foreground">K</span>
    </motion.div>
  );
}

function AnimatedLogo() {
  return (
    <div className="relative inline-block">
      <motion.span
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="font-[Syne] text-base font-bold text-foreground"
      >
        Knova
      </motion.span>
      <motion.svg
        width="100%"
        height="14"
        viewBox="0 0 60 14"
        className="absolute -bottom-2 left-0 text-primary"
      >
        <motion.path
          d="M 0,7 Q 15,2 30,7 Q 45,12 60,7"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1, delay: 0.3, ease: "easeInOut" }}
        />
      </motion.svg>
    </div>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  tour,
}: {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
  active: boolean;
  collapsed: boolean;
  tour?: string;
}) {
  const className = cn(
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200",
    active
      ? "bg-primary/15 font-medium text-primary shadow-sm shadow-primary/10"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
    collapsed && "justify-center px-2",
  );

  const content = (
    <>
      {active && (
        <motion.div
          layoutId="active-nav"
          className="absolute inset-0 rounded-xl bg-primary/15"
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        />
      )}
      <Icon
        className={cn(
          "relative h-4 w-4 shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="relative overflow-hidden whitespace-nowrap"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
      {collapsed && (
        <div className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
          {label}
        </div>
      )}
    </>
  );

  if (HARD_NAVIGATION.has(href)) {
    return (
      <a href={href} data-tour={tour} className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} data-tour={tour} className={className}>
      {content}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();
  const { startBestTour } = useKnovaOnboarding();
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 960) {
        setCollapsed(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const filteredItems = useMemo(() => {
    if (!search.trim()) {
      return NAV;
    }

    const normalized = search.trim().toLowerCase();
    return NAV.filter((item) => item.label.toLowerCase().includes(normalized));
  }, [search]);

  const initials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 248 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="relative flex h-screen flex-col border-r border-border bg-card shadow-sm"
    >
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setCollapsed((value) => !value)}
        className="absolute -right-4 top-30 z-50 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground md:flex"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </motion.button>

      <div className="flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-sm">
        <LogoMark />
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2 }}
            >
              <AnimatedLogo />
            </motion.div>
          )}
        </AnimatePresence>
      </div>


      <nav className={cn("flex-1 space-y-0.5 px-2 py-2", collapsed ? "overflow-hidden" : "overflow-y-auto")}>
        {filteredItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            tour={item.tour}
            collapsed={collapsed}
            active={
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
            }
          />
        ))}
      </nav>

      <div className="space-y-2 border-t border-border p-3">
        <AnimatePresence>
          {!collapsed && user && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <XpBar level={user.level} xp={user.xp} onStartTour={startBestTour} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 p-2", collapsed && "justify-center")}>
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary ring-2 ring-primary/20"
          >
            {initials}
          </motion.div>

          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="min-w-0 flex-1 overflow-hidden"
              >
                <p className="truncate text-xs font-semibold">
                  {user?.firstName
                    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
                    : user?.email}
                </p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Button
          variant="ghost"
          onClick={() => logout.mutate()}
          className={cn(
            "w-full gap-2.5 text-xs font-medium text-red-500 hover:bg-red-500/10 hover:text-red-600",
            collapsed ? "justify-center px-2" : "justify-start",
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap"
              >
                Выйти
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </div>
    </motion.aside>
  );
}
