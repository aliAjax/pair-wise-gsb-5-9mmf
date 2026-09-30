import {useState} from 'react';
import {BadgeCheck, FileClock, Plus, ScrollText, ShieldCheck} from 'lucide-react';
import type {DBShape, RiskLevel} from '../types';
import {
  currentVerdict, exceptionStateFor, historyPackages, pkgCoord,
  EXCEPTION_ISSUE_TEXT,
} from '../engine';
import {fmtTime, LEVEL_LABEL, shortFp, STATUS_META, SUPERSEDE_TEXT} from '../labels';
import type {LogEntry} from '../store';

/* ---------------- 策略版本 ---------------- */

export function PolicyPanel({db, onBump}: {db: DBShape; onBump: () => void}) {
  const canBump = db.policies[db.policies.length - 1].id === db.currentPolicyVersion && db.currentPolicyVersion === 'POL-2025.06';
  return (
    <div className="policy-panel">
      <div className="panel-head">
        <div>
          <h2>裁决策略版本</h2>
          <p>每条裁决与例外都绑定策略版本；发布新版后，基于旧版的结论全部回到待复核。</p>
        </div>
        <button className="primary" disabled={!canBump} onClick={onBump}>
          <BadgeCheck size={14}/> 发布 POL-2026.10
        </button>
      </div>
      <div className="policy-list">
        {db.policies.slice().reverse().map(p => (
          <div key={p.id} className={`policy-card ${p.id === db.currentPolicyVersion ? 'current' : ''}`}>
            <div className="policy-card-head">
              <b>{p.id}</b>
              {p.id === db.currentPolicyVersion && <span className="badge ok"><ShieldCheck size={12}/> 当前生效</span>}
            </div>
            <p className="small muted">{p.note} · 发布于 {fmtTime(p.publishedAt)}</p>
            <div className="rule-grid">
              {Object.entries(p.rules).map(([lic, r]) => (
                <span key={lic} className="rule-item">
                  <i className="license">{lic}</i>
                  <em className={`lvl lvl-${r.level}`}>{LEVEL_LABEL[r.level]}</em>
                </span>
              ))}
              <span className="rule-item">
                <i className="license">未收录许可证</i>
                <em className={`lvl lvl-${p.defaultLevel}`}>{LEVEL_LABEL[p.defaultLevel]}</em>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 例外审批总表 ---------------- */

export function ExceptionsPanel({
  db,
  onAdd,
}: {
  db: DBShape;
  onAdd: (input: {
    name: string;
    version: string;
    fingerprint: string;
    level: RiskLevel;
    approver: string;
    ticket: string;
    expiresAt: string | null;
    note: string;
  }) => void;
}) {
  const now = new Date().toISOString();
  const [open, setOpen] = useState(false);
  const [coordSel, setCoordSel] = useState('');
  const [ticket, setTicket] = useState('');
  const [approver, setApprover] = useState('当前用户');
  const [level, setLevel] = useState<RiskLevel>('allow');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');

  const currentPkgs = Object.values(db.packages).filter(p => !p.supersededBy).sort((a, b) => pkgCoord(a).localeCompare(pkgCoord(b)));
  const selPkg = currentPkgs.find(p => p.fingerprint === coordSel);

  const submit = () => {
    if (!selPkg) return;
    onAdd({
      name: selPkg.name,
      version: selPkg.version,
      fingerprint: selPkg.fingerprint,
      level,
      approver,
      ticket: ticket.trim(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      note: note.trim() || `例外放行 ${pkgCoord(selPkg)}`,
    });
    setOpen(false);
    setTicket('');
    setNote('');
    setExpiresAt('');
  };

  return (
    <div className="policy-panel">
      <div className="panel-head">
        <div>
          <h2>站内例外审批</h2>
          <p>只有「包指纹一致 + 策略版本一致 + 未过期未撤销」的例外才能被沿用；条件不符逐条标红。新例外自动绑定当前包指纹与策略版本。</p>
        </div>
        <button className="primary" onClick={() => setOpen(o => !o)}><Plus size={14}/> 登记新例外</button>
      </div>

      {open && (
        <div className="exc-form">
          <label>针对当前包
            <select value={coordSel} onChange={e => setCoordSel(e.target.value)}>
              <option value="">选择包…</option>
              {currentPkgs.map(p => (
                <option key={p.fingerprint} value={p.fingerprint}>
                  {pkgCoord(p)} · 当前裁决 {STATUS_META[currentVerdict(db, p).status].label}
                </option>
              ))}
            </select>
          </label>
          <label>工单号<input value={ticket} onChange={e => setTicket(e.target.value)} placeholder="如 SEC-2026-099"/></label>
          <label>审批人<input value={approver} onChange={e => setApprover(e.target.value)}/></label>
          <label>批准结论
            <select value={level} onChange={e => setLevel(e.target.value as RiskLevel)}>
              <option value="allow">放行</option>
              <option value="review">需复核</option>
              <option value="deny">拒绝</option>
            </select>
          </label>
          <label>到期时间（留空为长期）<input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}/></label>
          <label className="full">说明<input value={note} onChange={e => setNote(e.target.value)} placeholder="例外原因"/></label>
          <div className="exc-form-foot">
            {selPkg && (
              <span className="muted small">
                将绑定指纹 <b className="fp-inline">{shortFp(selPkg.fingerprint)}</b> 与策略 <b>{db.currentPolicyVersion}</b>；
                内容变化或策略升级后本例外自动失效
              </span>
            )}
            <button className="primary" disabled={!selPkg} onClick={submit}>提交例外（{LEVEL_LABEL[level]}）</button>
          </div>
        </div>
      )}

      <div className="exc-table">
        <div className="tr th"><span>例外 / 工单</span><span>包</span><span>指纹</span><span>策略</span><span>有效期</span><span>适用性</span></div>
        {db.exceptions.map(ex => {
          const currentFp = db.coordIndex[`${ex.name}@${ex.version}`];
          const pkg = currentFp ? db.packages[currentFp] : undefined;
          const st = pkg ? exceptionStateFor(ex, pkg, db.currentPolicyVersion, now) : null;
          return (
            <div className="tr" key={ex.id}>
              <span><b>{ex.id}</b><br/><span className="muted small">{ex.ticket} · {ex.approver}</span></span>
              <span>{ex.name} <span className="muted">{ex.version}</span></span>
              <span className="muted small" title={ex.fingerprint}>
                {shortFp(ex.fingerprint)}
                {pkg && ex.fingerprint !== pkg.fingerprint && <em className="mismatch-line"> ≠ 当前 {shortFp(pkg.fingerprint)}</em>}
              </span>
              <span className={ex.policyVersion === db.currentPolicyVersion ? '' : 'mismatch'}>
                {ex.policyVersion}
              </span>
              <span className="muted small">{ex.expiresAt ? fmtTime(ex.expiresAt) : '长期'}</span>
              <span>
                {!pkg
                  ? <span className="muted small">对应包不在库</span>
                  : st?.applicable
                    ? <span className="badge ok">可沿用</span>
                    : st && (
                      <span className="badge bad" title={st.issues.map(i => EXCEPTION_ISSUE_TEXT[i]).join('；')}>
                        不可沿用：{st.issues.map(i => EXCEPTION_ISSUE_TEXT[i]).join('、')}
                      </span>
                    )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 历史查询 ---------------- */

export function HistoryPanel({db, query, onSelect}: {db: DBShape; query: string; onSelect: (fp: string) => void}) {
  const rows = historyPackages(db, query);
  return (
    <div className="policy-panel">
      <div className="panel-head">
        <div>
          <h2>历史结论查询 <FileClock size={15} className="inline-icon"/></h2>
          <p>含被新内容替换的旧包与所有失效裁决；历史结论永远保留，但不进入清单、统计与报告。</p>
        </div>
      </div>
      <div className="exc-table">
        <div className="tr th"><span>包 / 指纹</span><span>许可证</span><span>最后出现</span><span>状态</span></div>
        {rows.map(p => {
          const view = currentVerdict(db, p);
          const superseded = !!p.supersededBy;
          const meta = STATUS_META[view.status];
          return (
            <button key={p.fingerprint} className={`tr hist-row ${superseded ? 'superseded' : ''}`} onClick={() => onSelect(p.fingerprint)}>
              <span>
                {pkgCoord(p)} <span className="muted small">{shortFp(p.fingerprint)}</span>
                {superseded && <em className="dead-tag"> 已被新内容替换</em>}
              </span>
              <span className="muted">{p.license ?? '未识别'}</span>
              <span className="muted small">{fmtTime(p.lastSeenAt)}</span>
              <span className={`status ${meta.cls}`}>
                {meta.label}
                {superseded && view.verdict?.reasonSuperseded && (
                  <em className="pending-why">{SUPERSEDE_TEXT[view.verdict.reasonSuperseded]}</em>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 操作日志 ---------------- */

export function ActivityLog({logs}: {logs: LogEntry[]}) {
  return (
    <div className="activity-log">
      <h3><ScrollText size={14}/> 处理日志</h3>
      {logs.length === 0 && <p className="muted small">迁移与批次事件会记录在这里</p>}
      {logs.map((l, i) => (
        <div key={i} className={`log-line ${l.kind}`}>
          <span className="log-dot"/>
          <div>
            <time>{fmtTime(l.at)}</time>
            <p>{l.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
