export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ deskId: string }>;
}) {
  return (
    <main className="flex-1 flex flex-col min-h-0">{children}</main>
  );
}
