import { CalendarClock, ShieldCheck, Undo2 } from 'lucide-react';
import { AppState } from '../domain/types';
import {
  activePackage,
  exceptionStatus,
  exceptionStatusLabel,
} from '../domain/engine';
import { shortFp } from '../domain/fingerprint';
import { fmtDate, fmtTime } from './format';

interface Props {
  state: AppState;
  now: number;
  actions: { revoke: (id: string) => void };
}

export function Exceptions({ state, now, actions }: Props) {
  const ordered = [...state.exceptions].sort((a, b) => b.grantedAt - a.grantedAt);
  return (
    <section className="exceptions">
      <div className="section-head">
        <div>
          <h2><ShieldCheck size={17}/> 站内例外审批</h2>
          <p>例外只有在<b>包指纹一致 + 策略版本一致 + 未过期</b>三个条件同时满足时才沿用；任一不满足即停止沿用，回落到站点裁决口径。</p>
        </div>
      </div>

      <div className="ex-grid">
        {ordered.map((ex) => {
          const pkg = activePackage(state.packages, ex.key);
          const st = exceptionStatus(ex, pkg, state.policy.version, now);
          const currentFp = pkg?.fingerprint;
          return (
            <div key={ex.id} className={'ex-card st-' + st}>
              <div className="ex-head">
                <b>{ex.id}</b>
                <span className={'ex-badge ' + st}>{exceptionStatusLabel(st)}</span>
              </div>
              <div className="ex-pkg">{ex.key}{pkg && <em>@{pkg.version}</em>}</div>
              <p className="ex-reason">{ex.reason}</p>

              <div className="ex-checks">
                <div className={ex.fingerprint === currentFp ? 'ok' : 'bad'}>
                  <span>包指纹</span>
                  {ex.fingerprint === currentFp
                    ? '一致 ✓'
                    : `不一致 ✗（当前 ${currentFp ? shortFp(currentFp) : '包不存在'}）`}
                </div>
                <div className={ex.policyVersion === state.policy.version ? 'ok' : 'bad'}>
                  <span>策略版本</span>
                  {ex.policyVersion === state.policy.version
                    ? `一致 ✓（${ex.policyVersion}）`
                    : `不一致 ✗（签发于 ${ex.policyVersion}，当前 ${state.policy.version}）`}
                </div>
                <div className={now < ex.expiresAt && !ex.revoked ? 'ok' : 'bad'}>
                  <span><CalendarClock size={11}/> 有效期</span>
                  {ex.revoked
                    ? '已撤销 ✗'
                    : now < ex.expiresAt
                      ? `有效 ✓（至 ${fmtDate(ex.expiresAt)}）`
                      : `已过期 ✗（${fmtDate(ex.expiresAt)} 到期）`}
                </div>
              </div>

              <div className="ex-foot">
                <span>{ex.grantedBy} · {fmtTime(ex.grantedAt)}</span>
                {st === 'active'
                  ? <button className="link-btn danger" onClick={() => actions.revoke(ex.id)}><Undo2 size={12}/> 撤销例外</button>
                  : <span className="muted">不参与当前裁决</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
