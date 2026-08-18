import { redirect } from "next/navigation";
import { allowedDomains, currentUser } from "@/lib/auth";
import { AuthCard, RegisterForm } from "@/app/_auth/AuthForms";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await currentUser()) redirect("/");
  return (
    <AuthCard title="註冊新帳號" hint="僅開放公司信箱網域註冊。">
      <RegisterForm domains={allowedDomains()} />
    </AuthCard>
  );
}
