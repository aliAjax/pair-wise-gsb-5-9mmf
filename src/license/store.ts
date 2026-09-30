import {useSyncExternalStore} from 'react';
import type {
  BatchItemResult,
  DBShape,
  LegacyDep,
  RiskLevel,
} from './types';
import {commitBatch, manualReview, migrateLegacy, publishPolicy, readjudicate, readjudicateAllPending} from './ingest';
import {currentPackages, currentVerdict} from './engine';
import {
  buildBatchA,
  buildBatchB,
  emptyDB,
  LEGACY_DEPS,
  POLICY_V2,
  SEED_NOW,
} from './seed';

export const STORE_KEY = 'license-lens-db-v2';
export const LEGACY_KEY = 'license-lens';

export interface LogEntry {
  at: string;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface IngestStats {
  inserted: number;
  updatedSame: number;
  pendingChanged: number;
  pendingUnknown: number;
}

export function summarizeResults(results: BatchItemResult[] | undefined): IngestStats {
  const s: IngestStats = {inserted: 0, updatedSame: 0, pendingChanged: 0, pendingUnknown: 0};
  for (const r of results ?? []) {
    if (r.outcome === 'inserted') s.inserted += 1;
    if (r.outcome === 'updated-same') s.updatedSame += 1;
    if (r.outcome === 'pending-changed') s.pendingChanged += 1;
    if (r.outcome === 'pending-unknown') s.pendingUnknown += 1;
  }
  return s;
}

/** 首次打开：读取 v2 库；不存在则迁移旧版 v1 清单（演示环境注入种子旧数据） */
export function initStateFromStorage(storage: Storage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): {
  db: DBShape;
  logs: LogEntry[];
} {
  if (storage) {
    const raw = storage.getItem(STORE_KEY);
    if (raw) {
      try {
        return {db: JSON.parse(raw) as DBShape, logs: []};
      } catch {
        // 损坏则落到迁移流程
      }
    }
  }

  const logs: LogEntry[] = [];
  let db = emptyDB();

  let legacy: LegacyDep[] | null = null;
  const legacyRaw = storage?.getItem(LEGACY_KEY);
  if (legacyRaw) {
    try {
      legacy = JSON.parse(legacyRaw) as LegacyDep[];
    } catch {
      legacy = null;
    }
  }
  // 全新环境（演示）：注入与旧 App 相同的旧数据，保证能完整看到迁移过程
  if (!legacy || legacy.length === 0) {
    legacy = LEGACY_DEPS;
    logs.push({at: SEED_NOW, kind: 'info', text: `检测到旧版站内清单（v1 格式，共 ${legacy.length} 条）`});
  } else {
    logs.push({at: SEED_NOW, kind: 'info', text: `检测到本地旧版清单（v1 格式，共 ${legacy.length} 条）`});
  }
  const migrated = migrateLegacy(legacy, db, SEED_NOW);
  if (migrated) {
    db = migrated;
    logs.push({
      at: SEED_NOW,
      kind: 'success',
      text: `旧数据迁移完成：${legacy.length} 个包补全内容指纹并绑定策略版本 ${db.currentPolicyVersion}，历史结论保留可查`,
    });
  }
  return {db, logs};
}

/** 不依赖 React 的状态控制器，所有动作集中在这里，便于测试 */
export class LicenseController {
  db: DBShape;
  logs: LogEntry[];
  private listeners = new Set<() => void>();
  private version = 0;
  private storage: Storage | undefined;

  constructor(storage?: Storage) {
    this.storage = storage;
    const init = initStateFromStorage(storage);
    this.db = init.db;
    this.logs = init.logs;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    this.listeners.forEach(fn => fn());
  }

  private persist(next: DBShape): void {
    this.db = next;
    this.storage?.setItem(STORE_KEY, JSON.stringify(next));
    this.emit();
  }

  private log(kind: LogEntry['kind'], text: string): void {
    this.logs = [{at: new Date().toISOString(), kind, text}, ...this.logs].slice(0, 50);
    this.emit();
  }

  /** 到达一批离线扫描包（只是排队，尚未写入） */
  receiveBatch(which: 'A' | 'B'): void {
    const batch = which === 'A' ? buildBatchA() : buildBatchB();
    const next = structuredClone(this.db);
    next.batches.push(batch);
    this.persist(next);
    this.log('info', `「${batch.label}」已到达（${batch.items.length} 个包），来源 ${batch.origin}`);
  }

  /** 提交（或重试）一个批次：整批原子写入。失败只把该批留为待重试 */
  commit(batchId: string): boolean {
    const result = commitBatch(this.db, batchId);
    this.persist(result.db);
    const batch = result.db.batches.find(b => b.id === batchId);
    const stats = summarizeResults(result.itemResults);
    if (result.ok) {
      this.log(
        'success',
        `「${batch?.label}」整批写入成功：新增 ${stats.inserted}，指纹相同合并 ${stats.updatedSame}，内容变化回到待复核 ${stats.pendingChanged}，许可证未知 ${stats.pendingUnknown}`,
      );
    } else {
      this.log('error', `「${batch?.label}」${result.error}（第 ${batch?.attempts} 次尝试）`);
    }
    return result.ok;
  }

  bumpPolicy(): void {
    this.persist(publishPolicy(this.db, POLICY_V2));
    this.log('info', `新策略版本 ${POLICY_V2.id} 已发布：基于旧策略的裁决全部失效，相关包回到待复核；旧策略例外不再沿用`);
  }

  readjudicateOne(fingerprint: string): void {
    this.persist(readjudicate(this.db, fingerprint));
    this.log('success', '已按当前策略版本重新裁决');
  }

  readjudicatePending(): void {
    const pendingBefore = currentPackages(this.db).filter(p => currentVerdict(this.db, p).status === 'pending').length;
    this.persist(readjudicateAllPending(this.db));
    this.log('success', `已按策略 ${this.db.currentPolicyVersion} 对 ${pendingBefore} 个待复核包重新裁决（未知许可证仍需人工）`);
  }

  review(fingerprint: string, level: RiskLevel, reviewer: string, note: string): void {
    this.persist(manualReview(this.db, fingerprint, level, reviewer, note));
    this.log('success', '人工复核结论已入库');
  }

  /** 新增站内例外：绑定指定包的当前指纹与当前策略版本 */
  addException(input: {
    name: string;
    version: string;
    fingerprint: string;
    level: RiskLevel;
    approver: string;
    ticket: string;
    expiresAt: string | null;
    note: string;
  }): void {
    const next = structuredClone(this.db);
    const id = `EX-${String(next.exceptions.length + 1).padStart(3, '0')}`;
    next.exceptions.push({
      id,
      ticket: input.ticket || id,
      name: input.name,
      version: input.version,
      fingerprint: input.fingerprint,
      policyVersion: next.currentPolicyVersion,
      grantedLevel: input.level,
      approver: input.approver,
      grantedAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      note: input.note,
    });
    this.persist(next);
    this.log('success', `例外 ${input.ticket || id} 已登记（指纹与策略版本 ${next.currentPolicyVersion} 绑定）`);
  }

  retryAllFailed(): void {
    const failed = this.db.batches.filter(b => b.state === 'pending-retry');
    let cur = this.db;
    for (const b of failed) cur = commitBatch(cur, b.id).db;
    this.persist(cur);
    for (const b of failed) {
      const after = cur.batches.find(x => x.id === b.id);
      if (after?.state === 'committed') this.log('success', `「${b.label}」重试成功并已入库`);
      else this.log('error', `「${b.label}」重试仍然失败`);
    }
  }

  resetDemo(): void {
    this.storage?.removeItem(STORE_KEY);
    this.storage?.removeItem(LEGACY_KEY);
    const fresh = initStateFromStorage(this.storage);
    this.db = fresh.db;
    this.logs = fresh.logs;
    this.emit();
  }
}

/** React 绑定：订阅同一控制器实例，版本变化时触发组件重渲染 */
export function useLicenseStore(): LicenseController {
  useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return controller;
}

export const controller = new LicenseController();
