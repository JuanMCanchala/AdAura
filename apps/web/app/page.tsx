import { redirect } from "next/navigation";
import { SetupForm } from "@/components/SetupForm";
import { getSession } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function Home() {
  if (getSession()) redirect("/dashboard");
  return <SetupForm />;
}
