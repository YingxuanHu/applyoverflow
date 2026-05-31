import { redirect } from "next/navigation";

export default function ConnectedAccountsPage() {
  redirect("/settings#security");
}
