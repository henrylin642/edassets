import { AuthCard, ResetPasswordForm } from "@/app/_auth/AuthForms";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthCard title="設定新密碼" hint="設定後，其他裝置上已登入的工作階段都會被登出。">
      <ResetPasswordForm token={token ?? ""} />
    </AuthCard>
  );
}
