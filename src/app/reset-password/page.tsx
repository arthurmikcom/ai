import { ResetPasswordView } from "@/components/ResetPasswordView";

export const metadata = { title: "Новый пароль — MARYX Ai" };

/** Opened from the «Забыли пароль?» letter: /reset-password?token=… */
export default function ResetPasswordPage() {
  return <ResetPasswordView />;
}
