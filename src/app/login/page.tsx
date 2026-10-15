import { LoginView } from "@/components/LoginView";
import { socialProviders } from "@/lib/server/auth";

export const metadata = { title: "Вход — MARYX Ai" };

export default function LoginPage() {
  return <LoginView social={socialProviders()} />;
}
