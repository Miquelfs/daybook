import { OmyraHub } from "@/components/omyra/OmyraHub";

export const metadata = { title: "Omyra · Daybook" };

export default function OmyraPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 pb-20 pt-8">
      <OmyraHub />
    </main>
  );
}
