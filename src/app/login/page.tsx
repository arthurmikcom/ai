import { LoginView } from "@/components/LoginView";
import { socialProviders } from "@/lib/server/auth";
import { legalInfo } from "@/lib/server/legal";
import { mailConfigured } from "@/lib/server/mail";

export const metadata = { title: "Вход — MARYX Ai" };

export default function LoginPage() {
  return <LoginView social={socialProviders()} mail={mailConfigured()} support={legalInfo().email} />;
}
