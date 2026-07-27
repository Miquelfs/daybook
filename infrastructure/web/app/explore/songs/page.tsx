import Link from "next/link";
import { songsApi } from "@/lib/songs-api";
import { SongsClient } from "./SongsClient";

export default async function SongsPage() {
  const [stats, songs] = await Promise.all([
    songsApi.stats().catch(() => null),
    songsApi.list().catch(() => []),
  ]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      <Link
        href="/explore/databases"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
      >
        ← Databases
      </Link>
      <SongsClient initialSongs={songs} initialStats={stats} />
    </main>
  );
}
