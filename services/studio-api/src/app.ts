/** studio-api 应用工厂：数据集上传/列表/详情/预览行（G2 端点）。 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import {
  getDataset,
  insertDataset,
  listDatasets,
  openDb,
  updateReport,
  type DatasetRecord,
} from "./db.js";
import { EngineManager } from "./engine-manager.js";
import { PyBridgeExecutor } from "./pybridge.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);

export interface AppOptions {
  workspaceDir?: string;
  /** pybridge 执行器（上传后同步算画像/跑分）；缺省用真实 venv 执行器 */
  runPybridge?: (task: unknown) => Promise<unknown>;
}

function toApi(rec: DatasetRecord) {
  return {
    id: rec.id,
    name: rec.name,
    format: path.extname(rec.file_path).slice(1).toLowerCase() || "csv",
    rows: rec.row_count,
    columns: rec.columns,
    projectId: rec.project_id,
    createdAt: rec.created_at,
    profile: rec.profile,
    quality: rec.quality,
  };
}

export async function buildApp(opts: AppOptions = {}) {
  const workspace = opts.workspaceDir ?? path.join(REPO_ROOT, "workspace");
  const db = openDb(path.join(workspace, "studio.db"));
  const engineManager = new EngineManager();
  const runPybridge = opts.runPybridge ?? ((task: unknown) => new PyBridgeExecutor().run(task));

  const app = fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

  app.get("/api/health", async () => ({ status: "ok", engine: engineManager.running }));

  app.post("/api/datasets", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: "missing file field" });
    }
    const ext = path.extname(file.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.code(400).send({ error: `unsupported file type ${ext} (csv/xlsx only)` });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE" || code === "RequestFileTooLargeError") {
        return reply
          .code(413)
          .send({ error: `file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit` });
      }
      throw err;
    }
    if (buffer.byteLength === 0) {
      return reply.code(400).send({ error: "empty file" });
    }

    // 文件名只取 basename 并限制字符，防路径穿越
    const safeName = path.basename(file.filename).replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    const hash = createHash("sha256").update(buffer).digest("hex");
    const rawDir = path.join(workspace, "datasets", hash);
    const rawPath = path.join(rawDir, safeName);
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(rawPath, buffer); // 内容寻址：同内容重传复用，不重复落盘

    const client = await engineManager.ensureEngine();
    const name = path.basename(safeName, ext);
    const projectId = await client.createProject(rawPath, name);
    try {
      const columns = await client.getColumns(projectId);
      const rowCount = await client.getRowCount(projectId);

      // 画像/跑分先于入库计算：桥失败时抛错、不产生半注册数据集（REVIEW 轮 1 修复）
      const profile = await runPybridge({ task: "profile", file: rawPath });
      const quality = await runPybridge({ task: "rules", file: rawPath });

      const rec = insertDataset(db, {
        name,
        file_hash: hash,
        file_path: rawPath,
        project_id: projectId,
        row_count: rowCount,
        columns,
        profile,
        quality,
      });

      return reply.code(200).send(toApi(getDataset(db, rec.id)!));
    } catch (err) {
      // 孤儿项目补偿（M2/C1）：入库前任何失败都回收引擎项目，避免 engine-data 累积
      await client.deleteProject(projectId).catch((e) => {
        req.log.warn(`orphan project ${projectId} reclaim failed: ${String(e)}`);
      });
      throw err;
    }
  });

  app.get("/api/datasets", async () => ({
    datasets: listDatasets(db).map(toApi),
  }));

  app.get("/api/datasets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    return toApi(rec);
  });

  app.get("/api/datasets/:id/rows", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });

    const query = req.query as { offset?: string; limit?: string };
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));

    const client = await engineManager.ensureEngine();
    const page = await client.getRows(rec.project_id, offset, limit);
    return { total: page.total, offset, limit, columns: rec.columns, rows: page.rows };
  });

  app.get("/api/datasets/:id/profile", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    if (!rec.profile) {
      // 兼容无画像的历史行（如 T4 时期数据）：按需补算
      updateReport(db, rec.id, "profile", await runPybridge({ task: "profile", file: rec.file_path }));
      return toApi(getDataset(db, rec.id)!).profile;
    }
    return rec.profile;
  });

  app.post("/api/datasets/:id/rules/validate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const report = await runPybridge({ task: "rules", file: rec.file_path });
    updateReport(db, rec.id, "quality", report);
    return report;
  });

  // ===== 清洗工作台端点（M2/C1，全部经 adapter 直达引擎）=====

  app.post("/api/datasets/:id/operations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const body = req.body as { operations?: unknown[] } | null | undefined;
    if (!body || typeof body !== "object" || !Array.isArray(body.operations) || body.operations.length === 0) {
      return reply.code(400).send({ error: "body must be JSON like {\"operations\": [...]}" });
    }
    const client = await engineManager.ensureEngine();
    const entries = await client.applyOperations(rec.project_id, body.operations);
    return { entries, history: await client.getHistory(rec.project_id) };
  });

  app.get("/api/datasets/:id/history", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const client = await engineManager.ensureEngine();
    return client.getHistory(rec.project_id);
  });

  app.post("/api/datasets/:id/history/restore", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const body = req.body as { lastDoneID?: number } | null | undefined;
    if (!body || typeof body !== "object" || !Number.isInteger(body.lastDoneID) || (body.lastDoneID ?? 0) < 0) {
      return reply.code(400).send({ error: "body must be JSON like {\"lastDoneID\": <id>}" });
    }
    const client = await engineManager.ensureEngine();
    await client.undoRedo(rec.project_id, body.lastDoneID!);
    return client.getHistory(rec.project_id);
  });

  app.get("/api/datasets/:id/export", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const client = await engineManager.ensureEngine();
    const csv = await client.exportRowsCsv(rec.project_id);
    // HTTP 头不接受非 ASCII（中文名会 ERR_INVALID_CHAR）：RFC 5987 filename* + ASCII fallback
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="dataset-${rec.id}.csv"; filename*=UTF-8''${encodeURIComponent(rec.name)}.csv`,
      )
      .send(csv);
  });

  app.get("/api/datasets/:id/recipe", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const client = await engineManager.ensureEngine();
    const operations = await client.getOperations(rec.project_id);
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="dataset-${rec.id}.recipe.json"; filename*=UTF-8''${encodeURIComponent(rec.name)}.recipe.json`,
      )
      .send(operations);
  });

  app.addHook("onClose", async () => {
    await engineManager.stop();
    db.close();
  });

  // 生产形态：托管 studio-web 构建产物（SPA 路由回退到 index.html）
  const webDist = path.join(REPO_ROOT, "apps", "studio-web", "dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: `no route: ${req.url}` });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
