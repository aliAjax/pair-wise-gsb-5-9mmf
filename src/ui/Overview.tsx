import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, FileWarning, Inbox, Link2, Search, X } from 'lucide-react';
import { AppState } from '../domain/types';
import {
  activePackage,
  effectiveRuling,
  reconcile,
} from '../domain/engine';
import { currentRulings, stats, buildReport } from '../domain/report';
import { shortFp } from '../domain/fingerprint';
import { decisionMeta, download, fmtTime } from './format';
import { HistoryPanel } from './HistoryPanel';
import { GrantExceptionButton } from './ExceptionControls';

interface Props {
  state: AppState;
  now: number;
  actions: {
    grant: (key: string, reason: string, ttlDays: number) => void;
  };
}

const reconcileZh: Record<string, { label: string; cls: string }> = {
  matched: { label: '一致', cls: 'ok' },
  drifted: { label: '版本漂移', cls: 'warn' },
  missing: { label: '缺扫描包', cls: 'risk' },
};

export function Overview({ state, now, actions }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'allow' | 'review' | 'deny' | 'pending'>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => currentRulings(state, now), [state, now]);
  const s = useMemo(() => stats(state, now), [state, now]);
  const filtered = rows.filter(
    (r) =>
      (filter === 'all' || r.ruling.decision === filter) &&
      r.name.toLowerCase().includes(query.toLowerCase()),
  );
  const current = selected ? rows.find((r) => r.key === selected) : null;
  const currentPkg = selected ? activePackage(state.packages, selected) : null;
  const manifestEntry = selected
    ? state.manifest.find((m) => m.name.toLowerCase() === selected)
    : null;
  const recon = manifestEntry ? reconcile(state, manifestEntry) : null;

  return (
    <>
      <section className="summary">
        <div><span>有效包（按指纹去重）</span><b>{s.total}</b><small>同一内容只计一次</small></div>
        <div><span>允许</span><b className="teal">{s.allow}</b><small>{s.viaException} 个经例外沿用</small></div>
        <div><span>待复核</span><b className="orange">{s.review + s.pending}</b><small>内容/策略变化后回炉</small></div>
        <div><span>拒绝</span><b className="red">{s.deny}</b><small>建议替换或隔离</small></div>
      </section>

      <section className="workspace">
        <div className="table-pane">
          <div className="pane-head">
            <div>
              <h2>依赖清单 · 当前有效裁决</h2>
              <p>内容变化或策略升级后失效的旧裁决不在此显示</p>
            </div>
            <div className="tools">
              <div className="search"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索包名"/></div>
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">全部裁决</option>
                <option value="allow">允许</option>
                <option value="pending">待复核</option>
                <option value="review">复核</option>
                <option value="deny">拒绝</option>
              </select>
            </div>
          </div>
          <div className="table">
            <div className="tr th th5"><span>包</span><span>版本</span><span>许可证</span><span>内容指纹</span><span>当前有效裁决</span></div>
            {filtered.map((r) => {
              const meta = decisionMeta[r.ruling.decision];
              const pkg = activePackage(state.packages, r.key)!;
              return (
                <button key={r.key} className={r.key === selected ? 'tr tr5 selected' : 'tr tr5'} onClick={() => setSelected(r.key)}>
                  <span className="dep-name"><span className="pkg-dot"/> {r.name}</span>
                  <span className="muted">{r.version}</span>
                  <span className="muted">{r.license}</span>
                  <span className="fp" title={pkg.fingerprint}>{shortFp(pkg.fingerprint)}</span>
                  <span className={'status ' + meta.cls}>
                    {meta.cls === 'ok' ? <Check size={13}/> : <AlertTriangle size={13}/>} {meta.zh}
                    {r.ruling.source === 'exception' && <i className="via-ex">例外</i>}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="empty">没有符合条件的包</div>}
          </div>
          <div className="pane-foot">
            <button className="outline" onClick={() => download(`license-report-${state.policy.version}.md`, buildReport(state, now))}>
              <Download size={15}/> 导出合规报告（仅当前有效裁决）
            </button>
          </div>
        </div>

        {current && currentPkg && (
          <div className="detail">
            <div className="detail-head">
              <div className="detail-icon"><FileWarning size={20}/></div>
              <div><span>PACKAGE</span><h2>{current.name}</h2></div>
              <button className="close" onClick={() => setSelected(null)}><X size={16}/></button>
            </div>

            <div className="detail-grid two">
              <div><label>当前入库版本</label><b>{current.version}</b></div>
              <div><label>许可证</label><b>{current.license}</b></div>
              <div className="full"><label>内容指纹（内容一变即变）</label><b className="fp mono">{currentPkg.fingerprint}</b></div>
              <div><label>入库批次</label><b>{currentPkg.batchId ?? '旧版迁移'}</b></div>
              <div><label>入库时间</label><b>{fmtTime(currentPkg.ingestedAt)}</b></div>
            </div>

            {manifestEntry && recon && (
              <div className="reconcile">
                <div className="reconcile-top">
                  <span className="recon-title"><Inbox size={13}/> 站内清单对账</span>
                  <span className={'recon-badge ' + reconcileZh[recon].cls}>{reconcileZh[recon].label}</span>
                </div>
                <div className="reconcile-body">
                  清单声明 <b>{manifestEntry.name}@{manifestEntry.version}</b>
                  {recon === 'drifted' && <>，扫描入库为 <b>{current.version}</b>，清单版本落后于实际内容</>}
                  {recon === 'matched' && <>，与当前入库内容一致</>}
                  {recon === 'missing' && <>，尚无对应扫描包入库</>}
                </div>
              </div>
            )}

            <div className={'finding ' + decisionMeta[current.ruling.decision].cls}>
              <div className="finding-icon">
                {current.ruling.decision === 'allow' ? <Check size={16}/> : <AlertTriangle size={16}/>}
              </div>
              <div>
                <b>
                  当前有效裁决：{decisionMeta[current.ruling.decision].zh}
                  {current.ruling.source === 'exception' && <i className="via-ex big">经站内例外沿用</i>}
                  {current.ruling.source === 'auto-verdict' && <i className="via-auto">策略自动初判</i>}
                </b>
                <p>{current.ruling.reason}</p>
                {current.ruling.verdict && (
                  <p className="stamps">
                    <Link2 size={11}/>
                    裁决锁定指纹 {shortFp(current.ruling.verdict.fingerprint)} ·
                    策略版本 {current.ruling.verdict.policyVersion}
                    {current.ruling.verdict.migrated && <i className="via-mig">旧版迁移</i>}
                  </p>
                )}
              </div>
            </div>

            {current.ruling.decision === 'pending' && (
              <GrantExceptionButton pkgKey={current.key} pkgName={current.name} onGrant={actions.grant}/>
            )}

            <HistoryPanel state={state} pkgKey={current.key} now={now}/>
          </div>
        )}
      </section>
    </>
  );
}
