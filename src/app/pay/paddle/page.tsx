import { PaddleCheckout } from "@/components/pay/PaddleCheckout";

export const metadata = { title: "Оплата — MARYX Ai", robots: { index: false } };

export default function PaddlePayPage() {
  return <PaddleCheckout />;
}
