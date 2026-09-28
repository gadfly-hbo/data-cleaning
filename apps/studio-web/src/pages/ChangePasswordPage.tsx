/** 改密页（M9/V4）：管理员重置密码后首次登录强制到达；验证旧密码（临时密码）+ 新复杂度密码。 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePassword } from "../api.js";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await changePassword(oldPw, newPw);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text font-sans">
      <div className="w-[340px] grid gap-4">
        <div>
          <div className="text-[15px] font-semibold">修改密码</div>
          <p className="text-[11.5px] text-text-3 mt-1">
            管理员已重置你的密码——请输入临时密码并设置新密码后继续。
          </p>
        </div>
        <label className="grid gap-1">
          <span className="text-[11.5px] text-text-2">当前密码（临时密码）</span>
          <input
            type="password"
            className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]"
            value={oldPw}
            disabled={busy}
            onChange={(e) => setOldPw(e.target.value)}
            data-testid="chpw-old"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11.5px] text-text-2">新密码（≥8 位且至少两类字符）</span>
          <input
            type="password"
            className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]"
            value={newPw}
            disabled={busy}
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            data-testid="chpw-new"
          />
        </label>
        {error && <div className="text-fail text-[11.5px]" data-testid="chpw-error">{error}</div>}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !oldPw || !newPw}
          onClick={() => void submit()}
          data-testid="chpw-submit"
        >
          确认修改
        </button>
      </div>
    </div>
  );
}
