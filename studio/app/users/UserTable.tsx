"use client";

import { useState, useTransition } from "react";
import { issueResetLinkAction, deleteUserAction, type ResetLinkResult } from "./actions";

export interface Row {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false }) : "—";

export function UserTable({ rows, meId }: { rows: Row[]; meId: string }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<ResetLinkResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // clipboard blocked → the input below is selectable anyway
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">姓名</th>
              <th className="px-3 py-2">建立時間</th>
              <th className="px-3 py-2">最後登入</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">
                  {u.email}
                  {u.id === meId && <span className="ml-1 text-[10px] text-pink-600">（你）</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">{u.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{fmt(u.createdAt)}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{fmt(u.lastLoginAt)}</td>
                <td className="space-x-2 px-3 py-2 text-right whitespace-nowrap">
                  <button
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setMsg(null);
                        setLink(await issueResetLinkAction(u.id, u.email));
                      })
                    }
                    className="rounded border border-pink-600 px-2 py-1 text-xs text-pink-700 disabled:opacity-50"
                  >
                    產生重設連結
                  </button>
                  <button
                    disabled={pending || u.id === meId}
                    title={u.id === meId ? "不能刪除自己" : "刪除此帳號"}
                    onClick={() => {
                      if (!confirm(`確定刪除 ${u.email}？此帳號將無法再登入。`)) return;
                      start(async () => {
                        setLink(null);
                        const r = await deleteUserAction(u.id);
                        setMsg(r.ok ? r.message ?? "已刪除" : `⚠ ${r.message}`);
                      });
                    }}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 disabled:opacity-40"
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && <div className="text-xs text-gray-600">{msg}</div>}

      {link && !link.ok && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {link.message}</div>
      )}

      {link?.ok && (
        <div className="space-y-2 rounded-lg border border-pink-300 bg-pink-50 p-3">
          <div className="text-xs font-medium text-pink-800">
            {link.email} 的重設連結 — 60 分鐘內有效，只能使用一次
          </div>
          <div className="flex gap-2">
            <input
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded border border-pink-300 bg-white px-2 py-1 font-mono text-xs"
            />
            <button
              onClick={() => copy(link.url)}
              className="shrink-0 rounded bg-pink-600 px-3 py-1 text-xs font-medium text-white"
            >
              {copied ? "已複製 ✓" : "複製"}
            </button>
          </div>
          <p className="text-[11px] text-pink-700">
            用 LINE / Slack 等既有管道傳給本人。連結等同一次性密碼，不要貼在公開頻道。
          </p>
        </div>
      )}
    </div>
  );
}
