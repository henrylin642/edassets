"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loginAction, registerAction, forgotPasswordAction, resetPasswordAction, logoutAction } from "./actions";
import type { ActionResult } from "@/lib/errmsg";

const input =
  "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none";
const primary =
  "w-full rounded bg-pink-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

function Alert({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  const cls = r.ok
    ? "border-green-300 bg-green-50 text-green-700"
    : "border-red-300 bg-red-50 text-red-700";
  return (
    <div className={`rounded border px-3 py-2 text-xs ${cls}`}>
      {r.ok ? "✓ " : "⚠ "}
      {r.message}
    </div>
  );
}

/** Shared shell so all four auth screens look like one flow. */
export function AuthCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="space-y-4 rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-bold">AR Assets Studio</h1>
          <p className="text-sm text-gray-500">{title}</p>
          {hint && <p className="text-xs text-gray-400">{hint}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          setRes(null);
          const r = await loginAction(fd);
          setRes(r);
          if (r.ok) {
            router.push(r.next ?? "/");
            router.refresh(); // drop the cached signed-out render
          }
        })
      }
    >
      <input type="hidden" name="next" value={next} />
      <input className={input} name="email" type="email" placeholder="Email" autoComplete="username" required />
      <input className={input} name="password" type="password" placeholder="密碼" autoComplete="current-password" required />
      <Alert r={res} />
      <button className={primary} disabled={pending}>{pending ? "登入中…" : "登入"}</button>
      <div className="flex justify-between text-xs text-gray-500">
        <Link href="/forgot-password" className="hover:underline">忘記密碼？</Link>
        <Link href="/register" className="hover:underline">註冊新帳號</Link>
      </div>
    </form>
  );
}

export function RegisterForm({ domains }: { domains: string[] }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          setRes(null);
          const r = await registerAction(fd);
          setRes(r);
          if (r.ok) {
            router.push(r.next ?? "/");
            router.refresh();
          }
        })
      }
    >
      <input className={input} name="name" type="text" placeholder="姓名（選填）" autoComplete="name" />
      <input className={input} name="email" type="email" placeholder="Email" autoComplete="username" required />
      <input className={input} name="password" type="password" placeholder="密碼（至少 10 字，含字母與數字）" autoComplete="new-password" required />
      <input className={input} name="confirm" type="password" placeholder="再輸入一次密碼" autoComplete="new-password" required />
      {domains.length > 0 ? (
        <p className="text-xs text-gray-400">開放註冊的網域：{domains.map((d) => "@" + d).join("、")}</p>
      ) : (
        <p className="text-xs text-amber-600">目前尚未設定開放註冊的網域（AUTH_ALLOWED_EMAIL_DOMAINS），註冊會被拒絕。</p>
      )}
      <Alert r={res} />
      <button className={primary} disabled={pending}>{pending ? "建立中…" : "建立帳號"}</button>
      <div className="text-xs text-gray-500">
        已經有帳號了？<Link href="/login" className="hover:underline">登入</Link>
      </div>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);

  return (
    <form
      className="space-y-3"
      action={(fd) => start(async () => { setRes(null); setRes(await forgotPasswordAction(fd)); })}
    >
      <input className={input} name="email" type="email" placeholder="註冊時用的 Email" autoComplete="username" required />
      <Alert r={res} />
      <button className={primary} disabled={pending}>{pending ? "寄送中…" : "寄送重設連結"}</button>
      <div className="text-xs text-gray-500">
        想起來了？<Link href="/login" className="hover:underline">回到登入</Link>
      </div>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const router = useRouter();

  if (!token) {
    return (
      <div className="space-y-3">
        <Alert r={{ ok: false, message: "這個網址少了重設權杖，請直接點信件裡的連結。" }} />
        <Link href="/forgot-password" className="block text-xs text-gray-500 hover:underline">重新申請一封重設信</Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          setRes(null);
          const r = await resetPasswordAction(fd);
          setRes(r);
          if (r.ok) setTimeout(() => router.push("/login"), 1500);
        })
      }
    >
      <input type="hidden" name="token" value={token} />
      <input className={input} name="password" type="password" placeholder="新密碼（至少 10 字，含字母與數字）" autoComplete="new-password" required />
      <input className={input} name="confirm" type="password" placeholder="再輸入一次新密碼" autoComplete="new-password" required />
      <Alert r={res} />
      <button className={primary} disabled={pending}>{pending ? "更新中…" : "設定新密碼"}</button>
    </form>
  );
}

/** Header widget: who is signed in, plus sign out. */
export function UserMenu({ email }: { email: string }) {
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-500">
      <span className="max-w-[16ch] truncate" title={email}>{email}</span>
      <button
        onClick={() => start(async () => { await logoutAction(); })}
        disabled={pending}
        className="rounded border border-gray-300 px-2 py-1 disabled:opacity-50"
      >
        {pending ? "登出中…" : "登出"}
      </button>
    </span>
  );
}
