"use client";

import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConversationList({
  conversations,
  currentId,
  onSelect,
  onNew,
}: ConversationListProps) {
  const visible = conversations.slice(0, 8);

  function formatUpdatedAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Unknown time";
    }

    return formatDistanceToNow(date, { addSuffix: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <MessageSquare className="size-3.5" data-icon="inline-start" />
            Chief of Staff Chats
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Recent conversations</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onNew}>
            <Plus className="size-3.5" />
            <span>New conversation</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {visible.map((conv) => (
            <DropdownMenuItem
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={
                conv.id === currentId ? "bg-accent text-accent-foreground" : ""
              }
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {conv.title || "New conversation"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatUpdatedAt(conv.updatedAt)}
                </p>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
