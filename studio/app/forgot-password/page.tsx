import Link from "next/link";
import { AuthCard } from "@/app/_auth/AuthForms";

export const dynamic = "force-dynamic";

/**
 * No self-service reset by email.
 *
 * Sending mail would mean holding a long-lived credential: the org's GCP policy
 * (iam.disableServiceAccountKeyCreation) forbids service-account keys, and a
 * Google OAuth refresh token is revoked after six months unused — which is
 * roughly how often a password-reset feature gets used. So an admin issues the
 * link from /users and passes it over an existing trusted channel instead.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthCard title="忘記密碼">
      <div className="space-y-3 text-sm text-gray-600">
        <p>這個後台不寄密碼重設信，請聯絡系統管理員。</p>
        <p className="text-xs text-gray-500">
          管理員會在「使用者」頁面替你產生一組重設連結，透過 LINE 或 Slack 傳給你。
          連結 60 分鐘內有效，只能使用一次。
        </p>
        <Link href="/login" className="block text-xs text-gray-500 hover:underline">
          ← 回到登入
        </Link>
      </div>
    </AuthCard>
  );
}
