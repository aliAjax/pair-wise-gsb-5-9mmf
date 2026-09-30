import {useState} from 'react';
import {
  AlertTriangle, ArrowLeftRight, Check, CheckCircle2, FileCode2, Gavel, History, ShieldQuestion, X, XCircle,
} from 'lucide-react';
import type {DBShape, PackageRecord, RiskLevel} from '../types';
import {
  currentVerdict, exceptionsFor, verdictsFor, EXCEPTION_ISSUE_TEXT,
} from '../engine';
import {
  fmtTime, LEVEL_LABEL, shortFp, SOURCE_LABEL, STATUS_META, SUPERSEDE_TEXT, VERDICT_SOURCE_LABEL,
} from '../labels';

interface Props {
  db: DBShape;
  pkg: PackageRecord | null;
  isHistory?: boolean;
  onClose: () => void;
  onReadjudicate: (fingerprint: string) => void;
  onReview: (fingerprint: string, level: RiskLevel, reviewer: string, note: string) => void;
}

const STATUS_ICON = {ok: <Check size={13}/>, warn: <AlertTriangle size={13}/>, risk: <XCircle size={13}/>, pending: <ShieldQuestion size={13}/>};

export function DetailPanel({db, pkg, isHistory, onClose, onReadjudicate, onReview}: Props) {
  const [level, setLevel] = useState<RiskLevel>('allow');
  const [reviewer, setReviewer] = useState('当前用户');
  const [note, setNote] = useState('');

  if (!pkg) {
    return (
      <div className="detail empty-detail">
        <FileCode2 size={28}/>
        <p>选择左侧一个包，查看指纹、裁决依据、例外与历史结论。</p>
      </div>
    );
  }

  const view = currentVerdict(db, pkg);
  const excStates = exceptionsFor(db, pkg);
  const verdictHistory = verdictsFor(db, pkg.fingerprint);
  const meta = STATUS_META[view.status];

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-icon"><FileCode2 size={20}/></div>
        <div>
          <span>{isHistory ? 'HISTORY PACKAGE' : 'SELECTED PACKAGE'}</span>
          <h2>{pkg.name}</h2>
          <small>{pkg.version} · 来源 {pkg.sources.map(s => SOURCE_LABEL[s]).join('、')}</small>
        </div>
        <button className="close" onClick={onClose}><X size={16}/></button>
      </div>

      {pkg.supersededBy && (
        <div className="callout danger">
          <ArrowLeftRight size={14}/>
          <span>该包内容已被同坐标的新指纹替换（{shortFp(pkg.supersededBy)}），不出现在当前清单；本页保留其历史结论。</span>
        </div>
      )}

      <div className="detail-grid">
        <div className="fp-block">
          <label>内容指纹</label>
          <b title={pkg.fingerprint} className="fp">{shortFp(pkg.fingerprint)}</b>
        </div>
        <div><label>许可证</label><b>{pkg.license ?? '未识别'}</b></div>
        <div><label>首次发现</label><b>{fmtTime(pkg.firstSeenAt)}</b></div>
      </div>

      <div className={`finding ${meta.cls}`}>
        <div className="finding-icon">{STATUS_ICON[view.status]}</div>
        <div>
          <b>{isHistory || pkg.supersededBy ? '历史记录（非当前有效）' : `当前裁决：${meta.label}`}</b>
          <p>{view.note}</p>
          {view.verdict && (
            <p className="verdict-meta">
              依据策略 {view.verdict.policyVersion} · {VERDICT_SOURCE_LABEL[view.verdict.source]}
              {view.verdict.reviewer ? ` · ${view.verdict.reviewer}` : ''} · {fmtTime(view.verdict.createdAt)}
            </p>
          )}
        </div>
      </div>

      {!isHistory && !pkg.supersededBy && view.status === 'pending' && (
        <div className="review-actions">
          {pkg.license === null
            ? <span className="hint-text"><ShieldQuestion size={14}/> 许可证未识别，需在下方填写人工复核结论</span>
            : (
              <button className="outline" onClick={() => onReadjudicate(pkg.fingerprint)}>
                <Gavel size={14}/> 按当前策略（{db.currentPolicyVersion}）裁决
              </button>
            )}
        </div>
      )}

      <div className="detail-section">
        <h3><ShieldQuestion size={14}/> 站内例外审批（{excStates.length}）</h3>
        {excStates.length === 0 && <p className="muted small">该包没有登记例外审批</p>}
        {excStates.map((s) => (
          <div key={s.exception.id} className={`exc-card ${s.applicable ? 'ok' : 'bad'}`}>
            <div className="exc-head">
              <b>{s.exception.id} · {s.exception.ticket}</b>
              {s.applicable
                ? <span className="badge ok"><CheckCircle2 size={12}/> 可沿用</span>
                : <span className="badge bad"><XCircle size={12}/> 不可沿用</span>}
            </div>
            <p className="small muted">{s.exception.note}（审批人 {s.exception.approver}，{fmtTime(s.exception.grantedAt)}）</p>
            <div className="exc-cond">
              <span className={s.exception.fingerprint === pkg.fingerprint ? 'match' : 'mismatch'}>
                指纹：绑定 {shortFp(s.exception.fingerprint)}
              </span>
              <span className={s.exception.policyVersion === db.currentPolicyVersion ? 'match' : 'mismatch'}>
                策略：{s.exception.policyVersion}{s.exception.policyVersion !== db.currentPolicyVersion ? `（当前 ${db.currentPolicyVersion}）` : ''}
              </span>
              <span className={!s.exception.expiresAt || s.exception.expiresAt > new Date().toISOString() ? 'match' : 'mismatch'}>
                {s.exception.expiresAt ? `有效期至 ${fmtTime(s.exception.expiresAt)}` : '长期有效'}
              </span>
            </div>
            {!s.applicable && (
              <ul className="exc-issues">
                {s.issues.map(i => <li key={i}><XCircle size={11}/> {EXCEPTION_ISSUE_TEXT[i]}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="detail-section">
        <h3><History size={14}/> 裁决历史（{verdictHistory.length}）</h3>
        {verdictHistory.map(v => (
          <div key={v.id} className={`vh-row ${v.supersededAt ? 'dead' : 'alive'}`}>
            <div className="vh-main">
              <span className={`status-mini ${v.status}`}>{STATUS_META[v.status].label}</span>
              <b>{LEVEL_LABEL[v.level]}</b>
              <span className="muted small">{VERDICT_SOURCE_LABEL[v.source]} · 策略 {v.policyVersion}</span>
            </div>
            <div className="vh-sub small muted">
              {fmtTime(v.createdAt)}
              {v.supersededAt && <em className="dead-tag"> · {SUPERSEDE_TEXT[v.reasonSuperseded!]}（{fmtTime(v.supersededAt)}）</em>}
            </div>
            <p className="small muted vh-note">{v.note}</p>
          </div>
        ))}
      </div>

      {!isHistory && !pkg.supersededBy && (
        <div className="detail-section">
          <h3><Gavel size={14}/> 人工复核</h3>
          <div className="review-form">
            <label>结论
              <select value={level} onChange={e => setLevel(e.target.value as RiskLevel)}>
                <option value="allow">放行</option>
                <option value="review">需复核</option>
                <option value="deny">拒绝</option>
              </select>
            </label>
            <label>复核人<input value={reviewer} onChange={e => setReviewer(e.target.value)}/></label>
            <label className="full">说明<input value={note} onChange={e => setNote(e.target.value)} placeholder="复核意见"/></label>
            <button className="primary" onClick={() => {onReview(pkg.fingerprint, level, reviewer, note); setNote('');}}>
              提交复核结论（绑定 {db.currentPolicyVersion}）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
