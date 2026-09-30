import {AlertOctagon, CheckCircle2, Clock3, PackageOpen, RefreshCw, UploadCloud} from 'lucide-react';
import type {DBShape} from '../types';
import {summarizeResults} from '../store';
import {fmtTime} from '../labels';

interface Props {
  db: DBShape;
  onReceive: (which: 'A' | 'B') => void;
  onCommit: (batchId: string) => void;
  onRetryAll: () => void;
}

const STATE_LABEL = {
  queued: {text: '待写入', cls: 'queued'},
  'pending-retry': {text: '写入失败 · 待重试', cls: 'retry'},
  committed: {text: '已入库', cls: 'done'},
} as const;

export function BatchPanel({db, onReceive, onCommit, onRetryAll}: Props) {
  const hasFailed = db.batches.some(b => b.state === 'pending-retry');
  const arrivedA = db.batches.some(b => b.label === '离线扫描包 A');
  const arrivedB = db.batches.some(b => b.label === '离线扫描包 B');

  return (
    <div className="batch-panel">
      <div className="batch-intro">
        <div>
          <h2>离线扫描包接入</h2>
          <p>两批包前后到达。每批整包原子提交：任一包写入失败，本批全部回滚为待重试，已入库记录不受影响。</p>
        </div>
        <div className="batch-actions">
          <button className="outline" disabled={arrivedA} onClick={() => onReceive('A')}>
            <UploadCloud size={14}/> 接收扫描包 A
          </button>
          <button className="outline" disabled={arrivedB} onClick={() => onReceive('B')}>
            <UploadCloud size={14}/> 接收扫描包 B
          </button>
          <button className="primary" disabled={!hasFailed} onClick={onRetryAll}>
            <RefreshCw size={14}/> 重试所有失败批次
          </button>
        </div>
      </div>

      {db.batches.length === 0 && (
        <div className="empty-hint"><PackageOpen size={26}/><span>还没有扫描包到达，先接收 A，再接收 B（B 首次写入会模拟失败）</span></div>
      )}

      <div className="batch-list">
        {db.batches.map(b => {
          const st = STATE_LABEL[b.state];
          const stats = summarizeResults(b.itemResults);
          return (
            <div key={b.id} className={`batch-card ${st.cls}`}>
              <div className="batch-card-head">
                <div className="batch-title">
                  <span className={`batch-state-dot ${st.cls}`}/>
                  <b>{b.label}</b>
                  <span className="batch-state">{st.text}</span>
                </div>
                <span className="muted">{fmtTime(b.arrivedAt)} 到达 · 已尝试 {b.attempts} 次</span>
              </div>
              <div className="batch-origin">{b.origin}</div>
              <div className="batch-items">
                {b.items.map((it, i) => (
                  <span key={i} className="chip" title={it.filesSignature ? `包体签名：${it.filesSignature}` : '无包体签名'}>
                    {it.name}@{it.version}
                    {it.license === null ? <em className="nolicense"> 许可证未知</em> : ''}
                    {it.filesSignature ? <em className="signed"> · 新包体</em> : ''}
                  </span>
                ))}
              </div>
              {b.state === 'pending-retry' && (
                <div className="batch-error"><AlertOctagon size={14}/> {b.lastError}</div>
              )}
              {b.state === 'committed' && (
                <div className="batch-result">
                  <CheckCircle2 size={14}/>
                  新增 {stats.inserted} · 指纹相同合并 {stats.updatedSame} · 内容变化待复核 {stats.pendingChanged} · 未知许可证 {stats.pendingUnknown}
                </div>
              )}
              {b.state !== 'committed' && (
                <div className="batch-foot">
                  <button className="ghost" onClick={() => onCommit(b.id)}>
                    <Clock3 size={13}/> {b.state === 'pending-retry' ? '重试写入本批' : '提交本批'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
