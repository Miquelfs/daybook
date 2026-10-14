import { SystemStatusPage } from "@/components/system/SystemStatus";

export const metadata = { title: "Status · Daybook" };

export default function StatusPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <SystemStatusPage />
    </main>
  );
}
