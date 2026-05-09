"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { Desk } from "@/components/desks/desk-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles,
  ClipboardList,
  Cpu,
  FileText,
  BookOpen,
  ArrowLeft,
  ChevronsUpDown,
  Settings,
  Activity,
  Flag,
} from "lucide-react";

const colorDot: Record<string, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  // CSS class format from DB (text-blue-400, etc.)
  "text-blue-400": "bg-blue-400",
  "text-emerald-400": "bg-emerald-400",
  "text-violet-400": "bg-violet-400",
  "text-amber-400": "bg-amber-400",
  "text-red-400": "bg-red-400",
  "text-green-400": "bg-green-400",
  "text-cyan-400": "bg-cyan-400",
  "text-pink-400": "bg-pink-400",
};

interface DeskSidebarProps {
  deskId: string;
}

export function DeskSidebar({ deskId }: DeskSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [desks, setDesks] = useState<Desk[]>([]);
  const [currentDesk, setCurrentDesk] = useState<Desk | null>(null);

  useEffect(() => {
    fetch("/api/desks")
      .then((r) => r.json())
      .then((data: Desk[]) => {
        setDesks(data);
        const found = data.find((d) => d.slug === deskId || d.id === deskId);
        if (found) setCurrentDesk(found);
      })
      .catch(() => {});
  }, [deskId]);

  const prefix = `/desk/${deskId}`;

  const navigation = [
    { label: "Director", href: `${prefix}/copilot`, icon: Sparkles },
    { label: "Tasks", href: `${prefix}/tasks`, icon: ClipboardList },
    { label: "Skills", href: `${prefix}/agents`, icon: Cpu },
    { label: "Documents", href: `${prefix}/documents`, icon: FileText },
    { label: "Knowledge", href: `${prefix}/knowledge`, icon: BookOpen },
  ];

  const globalLinks = [
    { label: "Settings", href: "/settings", icon: Settings },
    { label: "Activity", href: "/activity", icon: Activity },
    { label: "Goals", href: "/goals", icon: Flag },
  ];

  const dotColor = currentDesk?.color
    ? colorDot[currentDesk.color] || "bg-foreground"
    : "bg-foreground";

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-card">
      {/* Desk header with switcher */}
      <div className="border-b border-border">
        <Link
          href="/"
          className="flex items-center gap-2 px-4 pt-3 pb-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" />
          Back to Desks
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2.5 px-4 pb-3 pt-1 outline-none">
            <div
              className={cn("size-2.5 shrink-0 rounded-full", dotColor)}
              aria-hidden="true"
            />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold leading-none truncate">
                {currentDesk?.name || "Loading..."}
              </p>
            </div>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Switch desk</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {desks.map((desk) => (
              <DropdownMenuItem
                key={desk.id}
                onClick={() => {
                  const segment = pathname.split("/").slice(3).join("/") || "copilot";
                  router.push(`/desk/${desk.slug}/${segment}`);
                }}
              >
                <div
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    desk.color ? colorDot[desk.color] || "bg-foreground" : "bg-foreground"
                  )}
                />
                <span className="truncate">{desk.name}</span>
                {desk.slug === deskId || desk.id === deskId ? (
                  <span className="ml-auto text-[10px] text-muted-foreground">current</span>
                ) : null}
              </DropdownMenuItem>
            ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desk navigation */}
      <nav className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="my-3 border-t border-border" />

        <ul className="space-y-0.5">
          {globalLinks.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <p className="text-[11px] text-muted-foreground">Revenue OS v0.1</p>
        <ThemeToggle />
      </div>
    </aside>
  );
}
