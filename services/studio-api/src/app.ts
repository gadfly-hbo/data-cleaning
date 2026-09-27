/** studio-api 应用工厂：数据集上传/列表/详情/预览行（G2 端点）。 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
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
import { ENGINE_PORT } from "@data-cleaning/adapter-openrefine";
import { PyBridgeExecutor } from "./pybridge.js";
import { startScheduler } from "./scheduler.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);

export interface AppOptions {
  workspaceDir?: string;
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
    // 引擎的 create-project-from-upload 不支持 xlsx（导入走 importing-controller 两阶段协议，M4 移交）：
    // xlsx 跳过引擎注册（project_id=0），画像/质量报告照常；预览/清洗等引擎功能返回 422
    const client = ext === ".xlsx" ? null : await engineManager.ensureEngine();
    const projectId = client ? await client.createProject(rawPath, name) : 0;
    try {
      const columns = client ? await client.getColumns(projectId) : [];
      const rowCount = client ? await client.getRowCount(projectId) : 0;

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
      if (client) await client.deleteProject(projectId).catch((e) => {
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
    if (rec.project_id === 0) {
      return reply.code(422).send({ error: "xlsx 数据集暂不支持引擎功能（预览/清洗/导出当前态）；画像与质量报告可用，完整 xlsx 支持见 M4" });
    }

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
    if (rec.project_id === 0) {
      return reply.code(422).send({ error: "xlsx 数据集暂不支持引擎功能（预览/清洗/导出当前态）；画像与质量报告可用，完整 xlsx 支持见 M4" });
    }
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
    if (rec.project_id === 0) {
      return reply.code(422).send({ error: "xlsx 数据集暂不支持引擎功能（预览/清洗/导出当前态）；画像与质量报告可用，完整 xlsx 支持见 M4" });
    }
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
    if (rec.project_id === 0) {
      return reply.code(422).send({ error: "xlsx 数据集暂不支持引擎功能（预览/清洗/导出当前态）；画像与质量报告可用，完整 xlsx 支持见 M4" });
    }
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
      const result = (await runPybridge({
        task: "pipeline",
        file: ds.file_path,
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
