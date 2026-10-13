import { LoginView } from "@/components/LoginView";
import { socialProviders } from "@/lib/server/auth";

export const metadata = { title: "Вход — Nexus AI" };

export default function LoginPage() {
  return <LoginView social={socialProviders()} />;
}
