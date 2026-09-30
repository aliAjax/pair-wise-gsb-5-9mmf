import {
  ArrowRight,
  CheckCircle2,
  Copy,
  FileArchive,
  HardDriveDownload,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { AppState } from '../domain/types';
import { fingerprintExists } from '../domain/engine';
import { contentFingerprint, shortFp } from '../domain/fingerprint';
import { fmtTime } from './format';

interface Props {
  state: AppState;
  now: number;
  actions: {
    ingest: (batchId: string, dropInvalid?: boolean) => void;
  };
}

export function ScanBatches({ state, now, actions }: Props) {
  return (
    <section className="batches">
      <div className="section-head">
        <div>
          <h2><HardDriveDownload size={17}/> 离线扫描包接入</h2>
          <p>每批原子写入：任一损坏条目导致整批失败时，仅本批保留待重试，已入库记录不受影响。同内容指纹跨批只收一次。</p>
        </div>
      </div>

      <div className="batch-grid">
        {state.batches.map((b) => (
          <div key={b.id} className={'batch-card ' + b.status}>
            <div className="batch-head">
              <div className="batch-icon"><FileArchive size={18}/></div>
              <div>
                <b>{b.label}</b>
                <small>{b.id} · 到达 {fmtTime(b.arrivedAt)} · 尝试 {b.attempts} 次</small>
              </div>
              <span className={'batch-status ' + b.status}>
                {b.status === 'ingested' && <><CheckCircle2 size={13}/> 已入库</>}
                {b.status === 'pending' && <><RefreshCw size={13}/> 待写入</>}
                {b.status === 'failed' && <><XCircle size={13}/> 失败待重试</>}
              </span>
            </div>

            <div className="batch-items">
              {b.items.map((it, i) => {
                const fp = contentFingerprint(it);
                const dup = !it.corrupt && fingerprintExists(state.packages, fp);
                return (
                  <div key={i} className={'batch-item' + (it.corrupt ? ' corrupt' : '') + (dup ? ' dup' : '')}>
                    <span className="bi-name">{it.name || '未命名包'}<em>{it.version}</em></span>
                    <span className="bi-lic">{it.license}</span>
                    <span className="bi-fp mono" title={fp}>{shortFp(fp)}</span>
                    <span className="bi-tag">
                      {it.corrupt
                        ? <><ShieldAlert size={12}/> 条目损坏</>
                        : dup
                          ? <><Copy size={12}/> 指纹已收录（去重）</>
                          : <><ArrowRight size={12}/> 待收入</>}
                    </span>
                  </div>
                );
              })}
            </div>

            {b.error && <div className="batch-error">{b.error}</div>}

            {b.report && (
              <div className="batch-report">
                <div><b className="teal">{b.report.added.length}</b><span>新收入库</span></div>
                <div><b className="orange">{b.report.changed.length}</b><span>内容换代（原裁决失效）</span></div>
                <div><b className="muted-c">{b.report.duplicated.length}</b><span>指纹去重</span></div>
                {b.ingestedAt && <small>入库于 {fmtTime(b.ingestedAt)}</small>}
              </div>
            )}
            {(b.report?.changed.length ?? 0) > 0 && (
              <ul className="changed-list">
                {b.report!.changed.map((c) => (
                  <li key={c.key}>{c.name}：{c.fromVersion} <ArrowRight size={11}/> {c.toVersion}，旧裁决已失效回待复核</li>
                ))}
              </ul>
            )}

            {b.status !== 'ingested' && (
              <div className="batch-actions">
                <button className="primary" onClick={() => actions.ingest(b.id)}>
                  <HardDriveDownload size={14}/> {b.status === 'failed' ? '整批重试' : '写入本批'}
                </button>
                {b.items.some((it) => it.corrupt) && (
                  <button className="outline" onClick={() => actions.ingest(b.id, true)}>
                    <XCircle size={14}/> 剔除损坏条目并重试
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="now-hint">当前时间：{fmtTime(now)}</p>
    </section>
  );
}
