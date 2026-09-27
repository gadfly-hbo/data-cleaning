/** studio-api 应用工厂：数据集上传/列表/详情/预览行（G2 端点）。 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { createReadStream } from "node:fs";
import {
  getDataset,
  listDatasets,
  getPipeline,
  getRun,
  getVersion,
  hasRunningRun,
  insertDataset,
  insertPipeline,
  insertRun,
  insertVersion,
  finishRun,
  lastFinishedRunAt,
  listPipelines,
  listRuns,
  listVersions,
  ensureRawVersion,
  failStaleRuns,
  openDb,
  updateReport,
  type DatasetRecord,
  type PipelineRecord,
} from "./db.js";
import { EngineManager } from "./engine-manager.js";
import { ENGINE_PORT, OpenRefineClient } from "@data-cleaning/adapter-openrefine";
import { PyBridgeExecutor } from "./pybridge.js";
import { startScheduler } from "./scheduler.js";
import { requestSuggestions, resolveLlmConfig, type LlmConfig, type SuggestionColumn } from "./llm.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);

export interface AppOptions {
  workspaceDir?: string;
  /** LLM 建议配置注入（测试）；缺省读 env LLM_BASE_URL/LLM_API_KEY/LLM_MODEL */
  llm?: Partial<LlmConfig>;
  /** 默认启动管道调度器（30s 扫描）；测试可关 */
  enableScheduler?: boolean;
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
  for (const staleId of failStaleRuns(db)) {
    // 上次进程退出遗留的 running run 一律置 fail（否则管道永久 409/调度停摆）；
    // 其孤儿产物文件（若子进程在进程退出后写完）一并清理
    try {
      const ds = db
        .prepare("SELECT dataset_id FROM pipelines WHERE id = (SELECT pipeline_id FROM pipeline_runs WHERE id = ?)")
        .get(staleId) as { dataset_id: number } | undefined;
      if (ds) {
        // guard：已被版本行引用（source_run_id）的文件不删——进程可能恰在 insertVersion 后死亡（REVIEW 轮 3）
        const referenced = db
          .prepare("SELECT COUNT(*) AS n FROM dataset_versions WHERE source_run_id = ?")
          .get(staleId) as { n: number };
        if (referenced.n === 0) {
          const staleFile = path.join(workspace, "versions", String(ds.dataset_id), `run-${staleId}.csv`);
          if (existsSync(staleFile)) unlinkSync(staleFile);
        }
      }
    } catch {
      // 清理失败不阻塞启动
    }
  }
  const engineManager = new EngineManager();
  const llmRequested = Boolean(opts.llm?.baseUrl || process.env.LLM_BASE_URL);
  const llmConfig = resolveLlmConfig(opts.llm);
  const llmDegraded = llmRequested && llmConfig === null; // 配置了但畸形 URL（M4 清偿③补全）
  // 孤儿清扫（M4/Q2，K7）：首次引擎就绪后，删除无 dataset 行引用且 pipeline-temp 前缀的项目
  engineManager.onFirstReady(() => {
    void (async () => {
      // best-effort + 有限重试：引擎忙时首个 fetch 可能被 terminated（实测），重试 3 次退避
      for (let attempt = 1; attempt <= 3; attempt++) {
        const ok = await (async () => {
      try {
        // 与在跑管道运行的并发保护（REVIEW 轮 1 建议 2）：清扫可能删掉在跑 run 的临时项目
        const busyPipelineIds = new Set(
          (db.prepare("SELECT DISTINCT pipeline_id FROM pipeline_runs WHERE status = 'running'").all() as Array<{ pipeline_id: number }>).map((r) => r.pipeline_id),
        );
        if (busyPipelineIds.size > 0) {
          console.log("[startup-sweep] skipped: pipelines running（本轮放弃，不重试占用等待）");
          return true; // 与成功路径一致：无需重试
        }
          const client = new OpenRefineClient(ENGINE_PORT);
          const keep = new Set(
            (listDatasets(db) as unknown[] as Array<{ project_id: number }>).map((r) => r.project_id),
          );
          for (const { id, name } of await client.listProjectsWithNames()) {
            if (name.startsWith("pipeline-temp") && !keep.has(id)) {
              await client.deleteProject(id).catch(() => undefined);
              console.log(`[startup-sweep] removed orphan engine project ${id} (${name})`);
            }
          }
          return true;
        } catch (err) {
          console.error(`[startup-sweep] attempt ${attempt} failed:`, err);
          return false;
        }
        })();
        if (ok) return;
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
      }
    })();
  });
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

    const name = path.basename(safeName, ext);
    // xlsx 全功能（M4/Q1）：引擎 create-project 不吃 xlsx，先转规范 CSV 作为引擎工作形态
    // （K2 幂等：内容寻址目录下已存在即跳过）；raw 版本仍存 xlsx 原件（不可变字节）
    const engineFile = ext === ".xlsx" ? path.join(rawDir, "engine.csv") : rawPath;
    if (ext === ".xlsx" && !existsSync(engineFile)) {
      await runPybridge({ task: "xlsx_to_csv", src: rawPath, dst: engineFile });
    }
    const client = await engineManager.ensureEngine();
    const projectId = await client.createProject(engineFile, name);
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

      insertVersion(db, {
        dataset_id: rec.id, kind: "raw", file_path: rawPath,
        source_run_id: null, rows: rowCount,
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

    const query = req.query as { offset?: string; limit?: string; version?: string };
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));

    if (query.version !== undefined) {
      // 版本预览（J5）：经 pybridge 分页读文件，不经引擎
      ensureRawVersion(db, rec);
      const v = getVersion(db, rec.id, Number(query.version));
      if (!v) return reply.code(404).send({ error: `version ${query.version} not found` });
      const page = (await runPybridge({
        task: "rows", file: v.file_path, offset, limit,
      })) as { total: number; columns: string[]; rows: unknown[][] };
      return { total: page.total, offset, limit, columns: page.columns, rows: page.rows };
    }

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
    const query = req.query as { version?: string };
    if (query.version !== undefined) {
      // 版本导出：pipeline 版本（CSV 产物）直接文件流；raw xlsx 原件转经引擎导出 CSV（REVIEW 轮 1）
      ensureRawVersion(db, rec);
      const v = getVersion(db, rec.id, Number(query.version));
      if (!v) return reply.code(404).send({ error: `version ${query.version} not found` });
      // 版本导出只读不可变文件、按扩展名分流 mime，不依赖引擎（REVIEW 轮 2 BLOCKER：走引擎会导出工作台当前态）
      const ext = path.extname(v.file_path).toLowerCase();
      const dot = `.v${v.version}`;
      const mime =
        ext === ".xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv; charset=utf-8";
      const nameExt = ext === ".xlsx" ? ".xlsx" : ".csv";
      return reply
        .header("content-type", mime)
        .header(
          "content-disposition",
          `attachment; filename="dataset-${rec.id}${dot}${nameExt}"; filename*=UTF-8''${encodeURIComponent(rec.name)}${dot}${nameExt}`,
        )
        .send(createReadStream(v.file_path));
    }
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

  // ===== 管道（M3/P1）=====

  async function executePipelineRun(pipeline: PipelineRecord, runId: number): Promise<void> {
    try {
      const ds = getDataset(db, pipeline.dataset_id);
      if (!ds) throw new Error(`dataset ${pipeline.dataset_id} missing`);
      await engineManager.ensureEngine();

      const tempOut = path.join(workspace, "versions", String(pipeline.dataset_id), `run-${runId}.csv`);
      // 管道源用引擎工作形态：xlsx 数据集在内容寻址目录有上传时生成的 engine.csv（K2）
      const sourceFile = ds.file_path.endsWith(".xlsx")
        ? path.join(path.dirname(ds.file_path), "engine.csv")
        : ds.file_path;
      const result = (await runPybridge({
        task: "pipeline",
        file: sourceFile,
        recipe: pipeline.recipe,
        out_path: tempOut,
        engine_url: `http://127.0.0.1:${ENGINE_PORT}`,
      })) as {
        status: string; error?: string; dagster_run_id?: string; output_file?: string;
        rows?: number;
        quality?: { before: unknown; after: unknown; comparison: unknown[] };
      };
      if (result.status !== "ok" || !result.quality || !result.output_file) {
        throw new Error(result.error ?? "pipeline returned no result");
      }

      const version = insertVersion(db, {
        dataset_id: pipeline.dataset_id, kind: "pipeline", file_path: result.output_file,
        source_run_id: runId, rows: result.rows ?? 0,
      });
      finishRun(db, runId, {
        status: "ok",
        dagster_run_id: result.dagster_run_id ?? "",
        before: result.quality.before,
        after: result.quality.after,
        comparison: result.quality.comparison,
        output_version_id: version.id,
      });
    } catch (err) {
      // 失败清理：未入版本的产物文件残留（REVIEW 轮 1 建议 3）
      try {
        const stale = path.join(workspace, "versions", String(pipeline.dataset_id), `run-${runId}.csv`);
        if (existsSync(stale)) unlinkSync(stale);
      } catch {
        // 清理失败仅记日志
      }
      finishRun(db, runId, {
        status: "fail",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // P2 调度器将复用同一执行入口（PRD story 11 单一路径）
  app.decorate("executePipelineRun", executePipelineRun);

  // P2 调度器：与手动触发共用 executePipelineRun；随 app 关闭停止
  const stopScheduler = opts.enableScheduler === false
    ? () => {}
    : startScheduler(db, (pipeline, runId) => executePipelineRun(pipeline, runId));

  app.post("/api/pipelines", async (req, reply) => {
    const body = req.body as {
      dataset_id?: number; name?: string; interval_minutes?: number | null;
    } | null | undefined;
    if (!body || typeof body !== "object" || !body.dataset_id || !body.name) {
      return reply.code(400).send({ error: "body must be JSON like {\"dataset_id\", \"name\", \"interval_minutes\"?}" });
    }
    const interval =
      body.interval_minutes === undefined || body.interval_minutes === null
        ? null
        : Number(body.interval_minutes);
    if (interval !== null && (!Number.isInteger(interval) || interval < 1)) {
      return reply.code(400).send({ error: "interval_minutes must be a positive integer or null" });
    }
    const ds = getDataset(db, Number(body.dataset_id));
    if (!ds) return reply.code(404).send({ error: `dataset ${body.dataset_id} not found` });

    const client = await engineManager.ensureEngine();
    const recipe = await client.getOperations(ds.project_id); // 服务端快照当前操作历史
    const pipeline = insertPipeline(db, {
      dataset_id: ds.id, name: String(body.name), recipe, interval_minutes: interval,
    });
    return reply.code(200).send(toPipelineApi(pipeline));
  });

  app.get("/api/pipelines", async () => ({
    pipelines: listPipelines(db).map((p) => ({
      ...toPipelineApi(p),
      last_run: p.last_run_status ? { status: p.last_run_status } : null,
    })),
  }));

  app.post("/api/pipelines/:id/trigger", async (req, reply) => {
    const { id } = req.params as { id: string };
    const pipeline = getPipeline(db, Number(id));
    if (!pipeline) return reply.code(404).send({ error: `pipeline ${id} not found` });
    if (!Array.isArray(pipeline.recipe) || pipeline.recipe.length === 0) {
      return reply.code(400).send({ error: "pipeline recipe is empty (nothing to replay)" });
    }
    if (hasRunningRun(db, pipeline.id)) {
      return reply.code(409).send({ error: "a run of this pipeline is already in progress" });
    }
    const run = insertRun(db, pipeline.id);
    executePipelineRun(pipeline, run.id).catch((e) => {
      // finishRun 再抛（如 SQLite 故障）不应成为 unhandled rejection（REVIEW 轮 2）
      console.error(`[trigger] run ${run.id} finalization failed:`, e);
    }); // J3：fire-and-forget，完成回写
    return reply.code(202).send({ run_id: run.id });
  });

  app.get("/api/pipelines/:id/runs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const pipeline = getPipeline(db, Number(id));
    if (!pipeline) return reply.code(404).send({ error: `pipeline ${id} not found` });
    return { runs: listRuns(db, pipeline.id).map(toRunApi) };
  });

  app.get("/api/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = getRun(db, Number(id));
    if (!run) return reply.code(404).send({ error: `run ${id} not found` });
    return toRunApi(run);
  });

  app.get("/api/datasets/:id/lineage", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    ensureRawVersion(db, rec);
    const versions = listVersions(db, rec.id).map((v) => {
      if (v.source_run_id === null) {
        return { version: v.version, kind: v.kind, rows: v.rows, created_at: v.created_at, run: null };
      }
      const run = getRun(db, v.source_run_id);
      if (!run) {
        return { version: v.version, kind: v.kind, rows: v.rows, created_at: v.created_at, run: null };
      }
      const p = getPipeline(db, run.pipeline_id);
      const sum = (q: unknown) => {
        if (!q || typeof q !== "object") return null;
        const rules = (q as { rules?: Array<{ violations?: number }> }).rules;
        return Array.isArray(rules) ? rules.reduce((acc, r) => acc + (r.violations ?? 0), 0) : null;
      };
      return {
        version: v.version,
        kind: v.kind,
        rows: v.rows,
        created_at: v.created_at,
        run: {
          id: run.id,
          status: run.status,
          started_at: run.started_at,
          pipeline: p ? { name: p.name, recipe_steps: Array.isArray(p.recipe) ? p.recipe.length : 0 } : null,
          quality_summary:
            run.before_quality && run.after_quality && run.comparison
              ? {
                  before_total: sum(run.before_quality),
                  after_total: sum(run.after_quality),
                  delta:
                    (sum(run.after_quality) ?? 0) - (sum(run.before_quality) ?? 0),
                }
              : null,
        },
      };
    });
    return { dataset: { id: rec.id, name: rec.name }, versions };
  });

  // ===== 聚类相似值（M5/S3：S0 契约的 API 化）=====

  app.post("/api/datasets/:id/clusters", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const body = req.body as { column?: string; type?: "binning" | "knn"; function?: string } | null | undefined;
    if (!body || typeof body !== "object" || !body.column) {
      return reply.code(400).send({ error: 'body must be JSON like {"column": "<列名>", "type"?, "function"?}' });
    }
    if (rec.project_id === 0) {
      return reply.code(422).send({ error: "dataset has no engine project" });
    }
    const client = await engineManager.ensureEngine();
    const clusters = await client.computeClusters(rec.project_id, body.column, {
      type: body.type,
      function: body.function,
    });
    return { column: body.column, clusters };
  });

  // ===== DB 数据源接入（M5/S2，L2/L3/L4：连接纯内存、复用注册链路）=====

  app.post("/api/sources/db/test", async (req, reply) => {
    // story 1 测试连通（REVIEW 轮 1 BLOCKER 5）：轻量 SELECT 1，不拉数据不注册
    const body = req.body as { kind?: string; params?: Record<string, string> } | null | undefined;
    if (!body || typeof body !== "object" || !body.kind || !body.params) {
      return reply.code(400).send({ error: 'body must be JSON like {kind, params}' });
    }
    const probeCsv = path.join(workspace, "datasets", `.probe-${Date.now()}.csv`);
    try {
      const meta = (await runPybridge({
        task: "db_fetch", kind: body.kind, params: body.params,
        query: "SELECT 1 AS probe", out_csv: probeCsv,
      })) as { rows: number };
      return { ok: true, probe_rows: meta.rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ ok: false, error: `connection failed: ${message.slice(0, 200)}` });
    } finally {
      // 探针文件必清理（REVIEW 轮 2 BLOCKER 4①：测试连通不留文件）
      try { if (existsSync(probeCsv)) unlinkSync(probeCsv); } catch { /* best-effort */ }
    }
  });

  app.post("/api/sources/db", async (req, reply) => {
    const body = req.body as {
      kind?: string; params?: Record<string, string>; table?: string; query?: string; name?: string;
    } | null | undefined;
    if (!body || typeof body !== "object" || !body.kind || !body.params || (!body.table && !body.query)) {
      return reply.code(400).send({ error: 'body must be JSON like {kind, params, table?|query?, name?}' });
    }
    if (body.query && !/^\s*(select|with)\b/i.test(body.query)) {
      return reply.code(422).send({ error: "query must start with SELECT or WITH (read-only)" });
    }
    // 连接信息只存在于本请求内存：不打日志（fastify logger 已关）、错误不回显 params
    const outCsv = path.join(workspace, "datasets", `db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.csv`);
    let rows = 0;
    let columns: string[] = [];
    try {
      const meta = (await runPybridge({
        task: "db_fetch", kind: body.kind, params: body.params,
        table: body.table, query: body.query, out_csv: outCsv,
      })) as { rows: number; columns: string[] };
      rows = meta.rows;
      columns = meta.columns;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 不回显连接参数（message 来自 pybridge，只含 DSN 无密码的异常链——db_fetch 不打印 DSN）
      return reply.code(502).send({ error: `db fetch failed: ${message.slice(0, 300)}` });
    }
    if (rows === 0) {
      try { if (existsSync(outCsv)) unlinkSync(outCsv); } catch { /* best-effort */ }
      return reply.code(422).send({ error: "query returned 0 rows" });
    }

    // 内容寻址（REVIEW 轮 1 建议 4）：同表重复拉取复用同一目录，不再累积 db-*.csv
    const csvHash = createHash("sha256").update(await readFile(outCsv)).digest("hex");
    // 文件名消毒（REVIEW 轮 2 建议 5）：basename + 白名单，防路径穿越（与上传同口径）
    const safeName = (body.name?.trim() || body.table || "db-query")
      .split("/").pop()!.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    const hashDir = path.join(workspace, "datasets", csvHash);
    const hashPath = path.join(hashDir, `${safeName}.csv`);
    mkdirSync(hashDir, { recursive: true });
    if (hashPath !== outCsv) {
      if (!existsSync(hashPath)) {
        renameSync(outCsv, hashPath);
      } else {
        // 内容寻址命中：复用已有文件，新拉的 outCsv 清理（REVIEW 轮 2 BLOCKER 4③）
        try { unlinkSync(outCsv); } catch { /* best-effort */ }
      }
    }
    const finalCsv = existsSync(hashPath) ? hashPath : outCsv;

    // 复用文件上传的注册链路（引擎项目/raw v1/画像/质量）
    const name = body.name?.trim() || body.table || "db-query";
    const client = await engineManager.ensureEngine();
    const projectId = await client.createProject(finalCsv, name);
    try {
      const cols = columns.length > 0 ? columns : await client.getColumns(projectId);
      const rowCount = await client.getRowCount(projectId);
      const profile = await runPybridge({ task: "profile", file: finalCsv });
      const quality = await runPybridge({ task: "rules", file: finalCsv });
      const rec = insertDataset(db, {
        name, file_hash: csvHash, file_path: finalCsv,
        project_id: projectId, row_count: rowCount, columns: cols, profile, quality,
      });
      insertVersion(db, {
        dataset_id: rec.id, kind: "raw", file_path: finalCsv,
        source_run_id: null, rows: rowCount,
      });
      return reply.code(200).send(toApi(getDataset(db, rec.id)!));
    } catch (err) {
      await client.deleteProject(projectId).catch(() => undefined);
      throw err;
    }
  });

  // ===== LLM 清洗建议（M4/Q4）=====

  app.get("/api/llm/status", async () => ({
    enabled: llmConfig !== null,
    degraded: llmDegraded,
    model: llmConfig?.model ?? null,
    // 只暴露 host（边界声明用），不暴露 key/路径
    host: llmConfig ? new URL(llmConfig.baseUrl).host : null,
  }));

  app.post("/api/datasets/:id/suggest", async (req, reply) => {
    if (!llmConfig) {
      return reply.code(200).send({ enabled: false, hint: "未配置：设置环境变量 LLM_BASE_URL 与 LLM_API_KEY（可选 LLM_MODEL）后重启 studio-api" });
    }
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    const body = req.body as { column?: string } | null | undefined;
    if (!body || typeof body !== "object" || !body.column) {
      return reply.code(400).send({ error: 'body must be JSON like {"column": "<列名>"}' });
    }
    const profileCol = (rec.profile as { columns?: Array<SuggestionColumn & { top_values: Array<{ value: unknown }> }> } | null)
      ?.columns?.find((c) => c.name === body.column);
    if (!profileCol) {
      return reply.code(404).send({ error: `column ${body.column} not in profile` });
    }
    const column: SuggestionColumn = {
      name: profileCol.name,
      dtype: profileCol.dtype,
      null_ratio: profileCol.null_ratio ?? 0,
      top_values: (profileCol.top_values ?? []).map((t: { value: unknown }) => t.value).filter((v) => v !== null && v !== undefined),
    };
    try {
      const suggestions = await requestSuggestions(llmConfig, column);
      return reply.code(200).send({ enabled: true, suggestions });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const upstream = /abort|fetch failed|HTTP \d+|no message content/.test(message);
      return reply.code(upstream ? 502 : 422).send({ error: message });
    }
  });

  app.get("/api/datasets/:id/versions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = getDataset(db, Number(id));
    if (!rec) return reply.code(404).send({ error: `dataset ${id} not found` });
    ensureRawVersion(db, rec); // 旧数据集懒迁移
    return {
      versions: listVersions(db, rec.id).map((v) => ({
        version: v.version, kind: v.kind, rows: v.rows,
        source_run_id: v.source_run_id, created_at: v.created_at,
      })),
    };
  });

  function toPipelineApi(p: PipelineRecord) {
    return {
      id: p.id, dataset_id: p.dataset_id, name: p.name,
      recipe: p.recipe, interval_minutes: p.interval_minutes, created_at: p.created_at,
    };
  }

  function toRunApi(run: ReturnType<typeof getRun> & {}) {
    const version = run!.output_version_id
      ? listVersions(db, run!.pipeline_id ? getPipeline(db, run!.pipeline_id)!.dataset_id : 0)
          .find((v) => v.id === run!.output_version_id)
      : null;
    return {
      id: run!.id, pipeline_id: run!.pipeline_id, status: run!.status,
      dagster_run_id: run!.dagster_run_id,
      started_at: run!.started_at, finished_at: run!.finished_at, error: run!.error,
      quality: run!.comparison
        ? { before: run!.before_quality, after: run!.after_quality, comparison: run!.comparison }
        : null,
      output_version: version
        ? { version: version.version, kind: version.kind, rows: version.rows }
        : null,
    };
  }

  app.addHook("onClose", async () => {
    stopScheduler();
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
