"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandPalette } from "@/components/layout/command-palette";

interface AppFrameProps {
  children: React.ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full bg-background text-foreground">
      <Sidebar />
      <main className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
      <CommandPalette />
    </div>
  );
}
