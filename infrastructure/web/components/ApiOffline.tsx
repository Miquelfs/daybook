"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Auto-refreshes every 3 seconds until the API comes up.
// This handles the race where Next.js renders before FastAPI is ready.
export function ApiOffline() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/`
        );
        if (res.ok) {
          clearInterval(id);
          router.refresh();
        }
      } catch {
        // still offline — keep polling
      }
    }, 3000);

    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
      <p className="text-sm text-[#A1A1AA]">Waiting for API…</p>
      <p className="text-xs text-[#52525B]">
        Run{" "}
        <code className="bg-[#18181B] px-2 py-0.5 rounded">make api</code> in
        another terminal if it{"'"}s not started.
      </p>
    </div>
  );
}
