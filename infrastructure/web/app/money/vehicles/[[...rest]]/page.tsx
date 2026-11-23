import { redirect } from "next/navigation";

// Vehicles moved to Explore (next to Movement); old links and bookmarks land there.
export default async function OldVehicles({ params }: { params: Promise<{ rest?: string[] }> }) {
  const { rest = [] } = await params;
  redirect(`/explore/vehicles${rest.length ? `/${rest.map(encodeURIComponent).join("/")}` : ""}`);
}
