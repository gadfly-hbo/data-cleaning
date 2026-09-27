/** OpenRefine 引擎生命周期托管：惰性启动、单实例、随 app 关闭回收。 */

import {
  ENGINE_PORT,
  OpenRefineClient,
  startEngine,
  stopEngine,
  type EngineHandle,
} from "@data-cleaning/adapter-openrefine";

export class EngineManager {
  private handle: EngineHandle | null = null;
  private starting: Promise<EngineHandle> | null = null;

  async ensureEngine(): Promise<OpenRefineClient> {
    if (!this.handle) {
      this.starting ??= startEngine().then((handle) => {
        this.handle = handle;
        return handle;
      });
      try {
        await this.starting;
      } catch (err) {
        this.starting = null; // 失败后允许下次重试
        throw err;
      }
    }
    return new OpenRefineClient(ENGINE_PORT);
  }

  async stop(): Promise<void> {
    // 等待在途启动完成再回收：否则 startEngine().then 的赋值会在 stop 之后落地，
    // detached 引擎成孤儿占用端口（REVIEW 轮 1 修复）
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        // 启动失败：无句柄可回收
      }
    }
    const handle = this.handle;
    this.handle = null;
    this.starting = null;
    if (handle) await stopEngine(handle);
  }

  get running(): boolean {
    return this.handle !== null;
  }
}
