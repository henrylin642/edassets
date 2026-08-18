import { AuthCard, ForgotPasswordForm } from "@/app/_auth/AuthForms";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="忘記密碼" hint="我們會寄一封重設連結到你的信箱，連結 60 分鐘內有效。">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
