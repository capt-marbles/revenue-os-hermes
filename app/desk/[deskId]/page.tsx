import { redirect } from "next/navigation";

export default async function DeskPage({
  params,
}: {
  params: Promise<{ deskId: string }>;
}) {
  const { deskId } = await params;
  redirect(`/desk/${deskId}/copilot`);
}
