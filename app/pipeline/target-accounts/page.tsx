"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Building2, Mail, DollarSign, ChevronRight, X, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SALES_MOTIONS = ["inbound", "outbound", "partner", "referral", "expansion"] as const;

interface Deal {
  id: string; name: string; stage: string; salesMotion: string;
  contactName?: string | null; contactEmail?: string | null;
  closeDate?: string | null; mrr?: number | null;
  studioName?: string | null; notes?: string | null;
  createdAt: string; updatedAt: string;
}

type FormState = {
  name: string; salesMotion: string; contactName: string; contactEmail: string;
  closeDate: string; mrr: string; studioName: string; notes: string;
};

const BLANK: FormState = {
  name: "", salesMotion: "outbound", contactName: "", contactEmail: "",
  closeDate: "", mrr: "", studioName: "", notes: "",
};

export default function TargetAccountsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; deal: Deal | null }>({ open: false, deal: null });
  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);

  const fetch_ = useCallback(async () => {
    const res = await fetch("/api/deals");
    if (!res.ok) return;
    const data = await res.json();
    setDeals((data.grouped?.reachout ?? []) as Deal[]);
  }, []);

  useEffect(() => { fetch_().finally(() => setLoading(false)); }, [fetch_]);

  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const moveSelected = async (stage: string) => {
    if (!selected.size) return;
    setMoving(true);
    try {
      const res = await fetch("/api/deals/bulk-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], stage }),
      });
      if (!res.ok) { toast.error("Failed to move"); return; }
      const { moved } = await res.json();
      toast.success(`${moved} deal${moved !== 1 ? "s" : ""} moved to ${stage.replace("_", " ")}`);
      setSelected(new Set());
      fetch_();
    } finally { setMoving(false); }
  };

  const openCreate = () => { setForm(BLANK); setDialog({ open: true, deal: null }); };
  const openEdit = (deal: Deal) => {
    setForm({ name: deal.name ?? "", salesMotion: deal.salesMotion ?? "outbound", contactName: deal.contactName ?? "", contactEmail: deal.contactEmail ?? "", closeDate: deal.closeDate ?? "", mrr: deal.mrr != null ? String(deal.mrr) : "", studioName: deal.studioName ?? "", notes: deal.notes ?? "" });
    setDialog({ open: true, deal });
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      const payload = { ...form, stage: "reachout", mrr: form.mrr !== "" ? Number(form.mrr) : undefined, contactEmail: form.contactEmail || undefined, closeDate: form.closeDate || undefined };
      const isEdit = !!dialog.deal;
      const res = await fetch(isEdit ? `/api/deals/${dialog.deal!.id}` : "/api/deals", { method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { toast.error("Failed to save"); return; }
      toast.success(isEdit ? "Updated" : "Added");
      setDialog({ open: false, deal: null });
      fetch_();
    } finally { setSaving(false); }
  };

  const remove = async (deal: Deal) => {
    if (!confirm(`Delete "${deal.name}"?`)) return;
    await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
    toast.success("Deleted");
    fetch_();
  };

  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  return (
    <PageShell
      title="Target Accounts"
      description="Priority accounts queued for outbound and first-touch work"
      actions={
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" disabled={moving} onClick={() => moveSelected("connected")}>→ Connected</Button>
            </>
          )}
          <Button size="sm" onClick={openCreate}><Plus className="size-3.5 mr-1" /> Add account</Button>
        </div>
      }
    >
      <div className="p-4">
        {deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <p className="text-sm font-medium">No target accounts yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Add target accounts you want in active reachout</p>
            <Button size="sm" className="mt-4" onClick={openCreate}><Plus className="size-3.5 mr-1" /> Add account</Button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {deals.map((deal) => (
              <div
                key={deal.id}
                className={cn(
                  "group relative cursor-pointer rounded-xl border bg-card p-4 transition-all hover:shadow-md",
                  selected.has(deal.id) ? "border-primary bg-primary/5" : "border-border",
                )}
                onClick={() => openEdit(deal)}
              >
                <div className="flex items-start gap-2">
                  <button className="mt-0.5 shrink-0" onClick={(e) => { e.stopPropagation(); toggleSelect(deal.id); }}>
                    <div className={cn("h-3.5 w-3.5 rounded border transition-colors", selected.has(deal.id) ? "border-primary bg-primary" : "border-muted-foreground/40 group-hover:border-muted-foreground")}>
                      {selected.has(deal.id) && <svg viewBox="0 0 10 10" className="fill-primary-foreground"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-semibold leading-snug">{deal.name}</p>
                      <button className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); remove(deal); }}>
                        <X className="size-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                    {deal.studioName && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Building2 className="size-3 shrink-0" />{deal.studioName}</p>}
                    {deal.contactName && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="size-3 shrink-0" />{deal.contactName}</p>}
                    {deal.notes && <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{deal.notes}</p>}
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                      <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(deal.updatedAt), { addSuffix: true })}</span>
                      <button className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); moveSelected("connected"); }}>
                        Connected <ChevronRight className="size-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, deal: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog.deal ? "Edit target account" : "Add target account"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div><Label>Company / Deal name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Riot Games" /></div>
            <div><Label>Studio name</Label><Input value={form.studioName} onChange={(e) => setForm({ ...form, studioName: e.target.value })} placeholder="Studio or parent company" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contact name</Label><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Jane Smith" /></div>
              <div><Label>Contact email</Label><Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="jane@studio.com" /></div>
              <div><Label>Est. MRR</Label><Input type="number" min="0" value={form.mrr} onChange={(e) => setForm({ ...form, mrr: e.target.value })} placeholder="0" /></div>
              <div><Label>Sales motion</Label>
                <Select value={form.salesMotion} onValueChange={(v) => setForm({ ...form, salesMotion: v ?? form.salesMotion })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SALES_MOTIONS.map((m) => <SelectItem key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why we're targeting them, timing, ICP fit..." /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog({ open: false, deal: null })}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}{dialog.deal ? "Save" : "Add account"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
