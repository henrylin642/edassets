import Link from "next/link";
import { listUsers, requireUserOrRedirect } from "@/lib/auth";
import { UserMenu } from "@/app/_auth/AuthForms";
import { UserTable } from "./UserTable";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // Page-level gate is belt-and-braces; proxy.ts already redirects signed-out
  // browsers, and each action in ./actions.ts re-checks on its own.
  const me = await requireUserOrRedirect();
  const rows = await listUsers();

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-gray-500 hover:underline">← 返回</Link>
        <UserMenu email={me.email} />
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">使用者（{rows.length}）</h1>
        <p className="text-sm text-gray-500">
          這個後台不寄信。同事忘記密碼時，在這裡產生重設連結，用 LINE / Slack 傳給本人。
        </p>
      </header>

      <UserTable
        meId={me.id}
        rows={rows.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          createdAt: u.createdAt.toISOString(),
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        }))}
      />

      <p className="text-xs text-gray-400">
        新帳號由本人在 /register 自行註冊，僅限 AUTH_ALLOWED_EMAIL_DOMAINS 允許的網域。
        團隊都註冊完後，把該環境變數清空即可關閉註冊。
      </p>
    </main>
  );
}
