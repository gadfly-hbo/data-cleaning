/** 认证页面（M6/U4）：setup（首启管理员）与 login。 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authStatus, login, setup } from "../api.js";

function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[360px]">
        <div className="text-[15px] font-semibold mb-1">{title}</div>
        <div className="text-text-3 text-[10.5px] mb-4">data-cleaning studio</div>
        <div className="card p-4 grid gap-2.5">{children}</div>
        {footer && <div className="mt-3 text-center text-[10.5px] text-text-3">{footer}</div>}
      </div>
    </div>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authStatus().then((s) => {
      if (!s.needs_setup) navigate("/login");
    }).catch(() => undefined);
  }, [navigate]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await setup(username.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="创建管理员账号" footer="仅首次启动出现；此后管理员可在 API 中创建普通用户">
      <label className="grid gap-1">
        <span className="text-text-2 text-[11.5px]">用户名（3-32 字符）</span>
        <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={username} disabled={busy} onChange={(e) => setUsername(e.target.value)} data-testid="setup-username" />
      </label>
      <label className="grid gap-1">
        <span className="text-text-2 text-[11.5px]">密码（≥8 字符）</span>
        <input type="password" className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} data-testid="setup-password" />
      </label>
      {error && <div className="text-fail text-[11.5px]" data-testid="setup-error">{error}</div>}
      <button type="button" className="btn-primary" disabled={busy || username.trim().length < 3 || password.length < 8} onClick={() => void submit()} data-testid="setup-submit">
        {busy ? "创建中…" : "创建并进入"}
      </button>
    </AuthShell>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authStatus().then((s) => {
      if (s.needs_setup) navigate("/setup");
    }).catch(() => undefined);
  }, [navigate]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="登录" footer="本产品为本地单机设计——本机进程可直接访问数据引擎">
      <label className="grid gap-1">
        <span className="text-text-2 text-[11.5px]">用户名</span>
        <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={username} disabled={busy} onChange={(e) => setUsername(e.target.value)} data-testid="login-username" />
      </label>
      <label className="grid gap-1">
        <span className="text-text-2 text-[11.5px]">密码</span>
        <input type="password" className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} data-testid="login-password" />
      </label>
      {error && <div className="text-fail text-[11.5px]" data-testid="login-error">{error}</div>}
      <button type="button" className="btn-primary" disabled={busy || !username.trim() || !password} onClick={() => void submit()} data-testid="login-submit">
        {busy ? "登录中…" : "登录"}
      </button>
    </AuthShell>
  );
}
