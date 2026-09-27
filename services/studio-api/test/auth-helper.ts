/** 测试共用：每个集成测试文件起自己的 app 时，先 setup admin 拿 cookie 供全部请求。 */

export async function setupAuth(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "testadmin", password: "test-admin-pass-1" }),
  });
  // 已 setup（测试复用同库）则 login
  if (res.status === 409) {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "testadmin", password: "test-admin-pass-1" }),
    });
    return (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  }
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

/** 带 cookie 的 fetch 包装（multipart 或 json 皆可）。 */
export function authFetch(cookie: string) {
  return (url: string, init: RequestInit = {}) =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), cookie } });
}
