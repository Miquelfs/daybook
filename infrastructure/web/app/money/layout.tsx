import { MoneyNav } from "@/components/money/MoneyNav";

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MoneyNav />
      {children}
    </>
  );
}
