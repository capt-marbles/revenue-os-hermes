export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent mr-2" />
      Loading…
    </div>
  );
}
