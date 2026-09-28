/** 认证基础设施（M6/U0）：argon2id 哈希 + HMAC-SHA256 签名 cookie session。
 *
 * Session 形态（PRD diff 2 / GRILL N2-N3）：无服务端状态——payload {uid, exp} +
 * 签名；登出=客户端删 cookie；旧 cookie 至 exp 有效为已知接受边界（本地单机）。
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

export const SESSION_COOKIE = "dc_session";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export interface SessionPayload {
  uid: number;
  exp: number;
  /** M9/V3：会话记录表主键——吊销/查询的锚点；存量无 jti 的 cookie 由调用层回退信任签名 */
  jti?: string;
}

/** 会话密钥：workspace/.session-key（0600，32B hex），首启生成（N3）。 */
export class SessionKey {
  private readonly key: Buffer;

  constructor(keyPath: string) {
    if (!existsSync(keyPath)) {
      const dir = path.dirname(keyPath);
      if (!existsSync(dir)) throw new Error(`workspace missing: ${dir} — start engine once first`);
      writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
      chmodSync(keyPath, 0o600);
    }
    this.key = Buffer.from(readFileSync(keyPath, "utf-8").trim(), "hex");
    if (this.key.length !== 32) {
      throw new Error(`invalid session key at ${keyPath} (expected 32B hex) — delete to regenerate`);
    }
  }

  sign(payload: SessionPayload): string {
    const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
    const mac = createHmac("sha256", this.key).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  verify(token: string | undefined): SessionPayload | null {
    if (!token) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = createHmac("sha256", this.key).update(body).digest("base64url");
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as SessionPayload;
      if (typeof payload.uid !== "number" || typeof payload.exp !== "number") return null;
      if (payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return argonVerify(hashed, plain);
}

export function validatePassword(plain: string): string | null {
  if (plain.length < 8) return "密码至少 8 个字符";
  // M9/V1 复杂度：至少两类字符集（小写/大写/数字/符号）——避免过度策略伤本地工具可用性
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(plain)).length;
  if (classes < 2) return "密码需包含至少两类字符（小写/大写/数字/符号）";
  return null;
}

export function validateUsername(name: string): string | null {
  if (name.length < 3 || name.length > 32) return "用户名 3-32 个字符";
  if (!/^[\w.\-\u4e00-\u9fa5]+$/.test(name)) return "用户名仅限字母/数字/下划线/点/横线/中文";
  return null;
}
