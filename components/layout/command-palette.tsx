'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight, Zap, LayoutDashboard, MessageSquare, Inbox, CheckSquare, Target, Users, Send, GitBranch, Cpu, Database, FileText, Activity, Settings, Scan, PenTool, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  href?: string;
  action?: () => void;
  icon: React.ReactNode;
  group: string;
  keywords: string;
}

const pages: CommandItem[] = [
  {
    id: 'page-command-center',
    label: 'Command Center',
    href: '/command-center',
    icon: <LayoutDashboard className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'command center dashboard home',
  },
  {
    id: 'page-copilot',
    label: 'Chief of Staff',
    href: '/copilot',
    icon: <MessageSquare className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'copilot chief of staff assistant',
  },
  {
    id: 'page-inbox',
    label: 'Inbox',
    href: '/inbox',
    icon: <Inbox className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'inbox messages email',
  },
  {
    id: 'page-tasks',
    label: 'Tasks',
    href: '/tasks',
    icon: <CheckSquare className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'tasks todos',
  },
  {
    id: 'page-goals',
    label: 'Goals',
    href: '/goals',
    icon: <Target className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'goals objectives okrs',
  },
  {
    id: 'page-crm',
    label: 'CRM',
    href: '/crm',
    icon: <Users className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'crm contacts people',
  },
  {
    id: 'page-outreach',
    label: 'Outreach',
    href: '/outreach',
    icon: <Send className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'outreach campaigns',
  },
  {
    id: 'page-sequences',
    label: 'Sequences',
    href: '/sequences',
    icon: <GitBranch className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'sequences flows automation',
  },
  {
    id: 'page-agents',
    label: 'Skills',
    href: '/agents',
    icon: <Cpu className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'agents skills ai',
  },
  {
    id: 'page-memory',
    label: 'Memory',
    href: '/memory',
    icon: <Database className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'memory knowledge',
  },
  {
    id: 'page-documents',
    label: 'Documents',
    href: '/documents',
    icon: <FileText className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'documents files docs',
  },
  {
    id: 'page-activity',
    label: 'Activity',
    href: '/activity',
    icon: <Activity className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'activity log history',
  },
  {
    id: 'page-settings',
    label: 'Settings',
    href: '/settings',
    icon: <Settings className="h-4 w-4" />,
    group: 'Pages',
    keywords: 'settings configuration preferences',
  },
  {
    id: 'page-scout',
    label: 'Scout',
    href: '/desk/scout/copilot',
    icon: <Scan className="h-4 w-4" />,
    group: 'Desks',
    keywords: 'scout research desk',
  },
  {
    id: 'page-drafter',
    label: 'Drafter',
    href: '/desk/drafter/copilot',
    icon: <PenTool className="h-4 w-4" />,
    group: 'Desks',
    keywords: 'drafter writing desk',
  },
  {
    id: 'page-steward',
    label: 'Steward',
    href: '/desk/steward/copilot',
    icon: <Shield className="h-4 w-4" />,
    group: 'Desks',
    keywords: 'steward management desk',
  },
];

function useQuickActions(router: ReturnType<typeof useRouter>): CommandItem[] {
  return [
    {
      id: 'action-briefing',
      label: 'Generate daily briefing',
      action: async () => {
        await fetch('/api/command-center/briefing', { method: 'POST' });
        router.push('/command-center');
      },
      icon: <Zap className="h-4 w-4" />,
      group: 'Quick Actions',
      keywords: 'generate daily briefing report',
    },
    {
      id: 'action-refresh',
      label: 'Refresh queue',
      href: '/command-center',
      icon: <ArrowRight className="h-4 w-4" />,
      group: 'Quick Actions',
      keywords: 'refresh queue command center',
    },
    {
      id: 'action-new-task',
      label: 'New task',
      href: '/tasks',
      icon: <CheckSquare className="h-4 w-4" />,
      group: 'Quick Actions',
      keywords: 'new task create add',
    },
    {
      id: 'action-new-goal',
      label: 'New goal',
      href: '/goals',
      icon: <Target className="h-4 w-4" />,
      group: 'Quick Actions',
      keywords: 'new goal create add',
    },
  ];
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const quickActions = useQuickActions(router);
  const allItems = [...quickActions, ...pages];

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        if (!open) {
          setQuery('');
          setActiveIndex(0);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      // Slight delay to ensure the DOM is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const filtered = query.trim()
    ? allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.keywords.toLowerCase().includes(query.toLowerCase())
      )
    : allItems;

  // Reset active index when filtered results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  const executeItem = useCallback(
    (item: CommandItem) => {
      setOpen(false);
      setQuery('');
      if (item.action) {
        item.action();
      } else if (item.href) {
        router.push(item.href);
      }
    },
    [router]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        executeItem(filtered[activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setQuery('');
      }
    },
    [filtered, activeIndex, executeItem]
  );

  if (!mounted) return null;

  if (!open) return null;

  // Group filtered items
  const groups: { name: string; items: CommandItem[] }[] = [];
  const groupMap = new Map<string, CommandItem[]>();
  for (const item of filtered) {
    const existing = groupMap.get(item.group);
    if (existing) {
      existing.push(item);
    } else {
      groupMap.set(item.group, [item]);
    }
  }
  for (const [name, items] of groupMap) {
    groups.push({ name, items });
  }

  // Flat index tracking across groups
  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          setOpen(false);
          setQuery('');
        }}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-[15%] w-full max-w-lg -translate-x-1/2">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            className="max-h-80 overflow-y-auto p-2"
          >
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No results found.
              </div>
            ) : (
              groups.map((group) => {
                const groupStartIndex = flatIndex;
                const groupItems = group.items;
                flatIndex += groupItems.length;

                return (
                  <div key={group.name}>
                    <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {group.name}
                    </div>
                    {groupItems.map((item, i) => {
                      const itemFlatIndex = groupStartIndex + i;
                      const isActive = itemFlatIndex === activeIndex;

                      return (
                        <button
                          key={item.id}
                          data-active={isActive}
                          onClick={() => executeItem(item)}
                          onMouseEnter={() => setActiveIndex(itemFlatIndex)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                            isActive
                              ? 'bg-muted text-foreground'
                              : 'text-foreground/80 hover:bg-muted'
                          )}
                        >
                          <span className="shrink-0 text-muted-foreground">
                            {item.icon}
                          </span>
                          <span className="flex-1 text-left">{item.label}</span>
                          {item.href && (
                            <span className="text-[11px] text-muted-foreground">
                              {item.href}
                            </span>
                          )}
                          {item.action && (
                            <Zap className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1 py-0.5">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1 py-0.5">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1 py-0.5">esc</kbd>
              close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
