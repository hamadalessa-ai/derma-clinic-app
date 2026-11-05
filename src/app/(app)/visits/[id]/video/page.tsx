import { redirect } from "next/navigation";

/** The video call now lives on the visit screen (same note, alerts and photos). */
export default async function VideoVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/visits/${id}`);
}
