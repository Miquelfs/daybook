import { redirect } from "next/navigation";

// Streaks are about training consistency — they live in Omyra now.
export default function ActivityStreaksRedirect() {
  redirect("/omyra?tab=streaks");
}
