"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, FolderOpen, MessageSquare, GitFork,
  Mic, CheckSquare, FileText, BarChart2, Table2,
  Presentation, Settings, LogOut, ChevronLeft, ChevronRight,
  Search, HelpCircle,
} from "lucide-react";
import { useAuthStore } from "@/store/auth.store";
import { useLogout } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

function LogoMark() {
  return (
    <motion.div
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4, ease: "backOut" }}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-md shadow-primary/30"
    >
      <span className="text-primary-foreground font-bold text-base font-[Syne]">K</span>
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
        className="font-bold text-foreground font-[Syne] text-base"
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

interface NavItemProps {
  item: typeof NAV[0];
  active: boolean;
  collapsed: boolean;
}

function NavItem({ item, active, collapsed }: NavItemProps) {
  const isHardNavigation =
    item.href === "/chat" ||
    item.href === "/mindmap" ||
    item.href === "/podcast" ||
    item.href === "/quiz" ||
    item.href === "/table" ||
    item.href === "/infographic" ||
    item.href === "/reports" ||
    item.href === "/presentation";

  const content = (
    <>
      {active && (
        <motion.div
          layoutId="active-nav"
          className="absolute inset-0 rounded-xl bg-primary/15"
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        />
      )}
      <item.icon className={cn("relative h-4 w-4 shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="relative truncate overflow-hidden whitespace-nowrap"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>

      {collapsed && (
        <div className="pointer-events-none absolute left-full ml-3 z-50 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap">
          {item.label}
        </div>
      )}
    </>
  );

  const className = cn(
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200",
    active
      ? "bg-primary/15 text-primary font-medium shadow-sm shadow-primary/10"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
    collapsed && "justify-center px-2",
  );

  if (isHardNavigation) {
    return (
      <a href={item.href} data-tour={item.tour} className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      data-tour={item.tour}
      className={className}
    >
      {content}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const filtered = search
    ? NAV.filter((n) => n.label.toLowerCase().includes(search.toLowerCase()))
    : NAV;

  const initials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        animate={{ width: collapsed ? 72 : 248 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="relative flex h-screen flex-col border-r border-border bg-card shadow-sm"
      >
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-4 top-15 z-50 hidden md:flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted shadow-md transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </motion.button>

        <div className="flex h-16 items-center gap-3 px-4 border-b border-border bg-card/80 backdrop-blur-sm">
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

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="px-3 pt-3 pb-1"
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск..."
                  className="h-8 pl-9 text-xs bg-muted/50"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <nav className={cn("flex-1 px-2 py-2 space-y-0.5", collapsed ? "overflow-hidden" : "overflow-y-auto")}>
          {filtered.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              active={pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"))}
              collapsed={collapsed}
            />
          ))}
        </nav>

        <div className="border-t border-border p-3 space-y-2">
          <AnimatePresence>
            {!collapsed && user && (
              <motion.div
                data-tour="xp-bar"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-1 mb-2"
              >
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span className="font-medium">Ур. {user.level}</span>
                  <span>{user.xp} XP</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-linear-to-r from-primary to-accent"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((user.xp % 500) / 5, 100)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 p-2", collapsed && "justify-center")}>
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="h-8 w-8 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold ring-2 ring-primary/20"
            >
              {initials}
            </motion.div>
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  className="flex-1 min-w-0 overflow-hidden"
                >
                  <p className="text-xs font-semibold truncate">{user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user?.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
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
    </>
  );
}
