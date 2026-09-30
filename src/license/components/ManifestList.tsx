import {AlertTriangle, Check, ShieldQuestion, XCircle} from 'lucide-react';
import type {DBShape} from '../types';
import {currentPackages, currentVerdict, pkgCoord} from '../engine';
import {PENDING_REASON_TEXT} from '../engine';
import {shortFp, STATUS_META} from '../labels';

export type StatusFilter = 'all' | 'ok' | 'warn' | 'risk' | 'pending';

interface Props {
  db: DBShape;
  query: string;
  filter: StatusFilter;
  selectedFp: string | null;
  onSelect: (fp: string) => void;
}

const ICONS = {
  ok: <Check size={13}/>,
  warn: <AlertTriangle size={13}/>,
  risk: <XCircle size={13}/>,
  pending: <ShieldQuestion size={13}/>,
};

export function ManifestList({db, query, filter, selectedFp, onSelect}: Props) {
  const q = query.trim().toLowerCase();
  const rows = currentPackages(db)
    .map(p => ({pkg: p, view: currentVerdict(db, p)}))
    .filter(r => (filter === 'all' || r.view.status === filter))
    .filter(r => !q || pkgCoord(r.pkg).toLowerCase().includes(q) || r.pkg.fingerprint.includes(q));

  return (
    <div className="table">
      <div className="tr th">
        <span>包 / 指纹</span><span>许可证</span><span>依据策略</span><span>当前裁决</span>
      </div>
      {rows.length === 0 && <div className="table-empty">没有匹配的包</div>}
      {rows.map(({pkg, view}) => {
        const meta = STATUS_META[view.status];
        return (
          <button
            key={pkg.fingerprint}
            className={`tr ${pkg.fingerprint === selectedFp ? 'selected' : ''}`}
            onClick={() => onSelect(pkg.fingerprint)}
          >
            <span className="dep-name">
              <span className={`pkg-dot ${meta.cls}`}/>
              {pkg.name} <span className="muted">{pkg.version}</span>
              <span className="fp-cell" title={pkg.fingerprint}>{shortFp(pkg.fingerprint)}</span>
              {view.exception && <span className="exc-tag" title={`沿用例外 ${view.exception.ticket}`}>例外 {view.exception.ticket}</span>}
            </span>
            <span className="muted">{pkg.license ?? <em className="nolicense">未识别</em>}</span>
            <span className="muted small">
              {view.status === 'pending' && view.pendingReason === 'policy-updated'
                ? <>旧 {view.verdict?.policyVersion ?? '?'}</>
                : view.verdict?.policyVersion ?? db.currentPolicyVersion}
            </span>
            <span className={`status ${meta.cls}`}>
              {ICONS[view.status]} {meta.label}
              {view.status === 'pending' && view.pendingReason && view.pendingReason !== 'no-verdict' && (
                <em className="pending-why">{PENDING_REASON_TEXT[view.pendingReason]}</em>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
