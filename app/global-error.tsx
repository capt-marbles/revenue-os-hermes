"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 bg-background text-foreground">
          <div className="text-lg font-medium text-red-400">Something went wrong</div>
          <p className="text-sm text-muted-foreground max-w-md text-center">
            {error.message || "An unexpected error occurred."}
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground/50">Error ID: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
