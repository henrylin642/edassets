import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthCard, LoginForm } from "@/app/_auth/AuthForms";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Already signed in → don't show a login box, just go in.
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <AuthCard title="登入管理後台">
      <LoginForm next={next ?? "/"} />
    </AuthCard>
  );
}
