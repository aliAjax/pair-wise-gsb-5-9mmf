import { useState } from 'react';
import { BookUp2, GitBranch, Inbox, Rocket } from 'lucide-react';
import { AppState, License } from '../domain/types';
import { LICENSES } from '../domain/types';
import { reconcile } from '../domain/engine';
import { fmtTime } from './format';

interface Props {
  state: AppState;
  now: number;
  actions: {
    publishPolicy: (version: string, notes: string) => void;
    upsertManifest: (name: string, version: string, license: License) => void;
  };
}

const licenseZh: Record<License, string> = {
  MIT: 'MIT（宽松）',
  'BSD-3-Clause': 'BSD-3-Clause（宽松）',
  'Apache-2.0': 'Apache-2.0（宽松）',
  'MPL-2.0': 'MPL-2.0（弱著佐权）',
  'LGPL-2.1': 'LGPL-2.1（弱著佐权）',
  'GPL-3.0': 'GPL-3.0（强著佐权）',
  'AGPL-3.0': 'AGPL-3.0（网络强著佐权）',
  UNKNOWN: '未知',
};

const decisionZh: Record<string, string> = {
  allow: '自动允许',
  review: '进入复核',
  deny: '自动拒绝',
};

export function Policy({ state, now, actions }: Props) {
  const [version, setVersion] = useState('2026.09');
  const [notes, setNotes] = useState('收紧 BSD/Apache 至复核，LGPL 调整为拒绝');
  const [published, setPublished] = useState(false);

  const [name, setName] = useState('');
  const [ver, setVer] = useState('');
  const [lic, setLic] = useState<License>('MIT');

  const publish = () => {
    if (!version.trim()) return;
    actions.publishPolicy(version.trim(), notes.trim() || '策略例行更新');
    setPublished(true);
  };

  return (
    <section className="policy-view">
      <div className="section-head">
        <div>
          <h2><GitBranch size={17}/> 策略版本管理</h2>
          <p>发布新策略后，所有锁定旧版本的裁决立即失效并回到待复核；锁定旧策略版本的站内例外同步停止沿用。裁决记录保留可查。</p>
        </div>
      </div>

      <div className="policy-grid">
        <div className="policy-card current-policy">
          <span className="pc-label">当前生效版本</span>
          <b>{state.policy.version}</b>
          <small>发布于 {fmtTime(state.policy.publishedAt)}</small>
          <p>{state.policy.notes}</p>
          <div className="defaults">
            {(Object.keys(state.policy.defaults) as License[]).map((l) => (
              <div key={l}><span>{licenseZh[l]}</span><i className={'dec ' + state.policy.defaults[l]}>{decisionZh[state.policy.defaults[l]]}</i></div>
            ))}
          </div>
        </div>

        <div className="policy-card">
          <span className="pc-label"><BookUp2 size={13}/> 发布新版本（演示一次性升级）</span>
          <label className="p-field">新版本号<input value={version} onChange={(e) => setVersion(e.target.value)} disabled={published}/></label>
          <label className="p-field">变更说明
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={published}/>
          </label>
          <div className="new-defaults-hint">新版本默认规则：MIT 允许；BSD/Apache/MPL 复核；LGPL 及 GPL 系拒绝；未知复核。</div>
          <button className="primary full-btn" onClick={publish} disabled={published}>
            <Rocket size={14}/> {published ? `已发布 ${version}，请到复核队列重审` : '发布并使旧裁决批量失效'}
          </button>
        </div>
      </div>

      <div className="section-head mt">
        <div>
          <h2><Inbox size={17}/> 站内清单（声明依赖）</h2>
          <p>清单只负责声明；与扫描入库内容对账，版本/内容对不上时标记漂移。所有统计与报告以入库内容指纹为准。</p>
        </div>
      </div>

      <div className="manifest-box">
        <div className="tr th th3"><span>声明包</span><span>声明版本/许可证</span><span>对账</span></div>
        {state.manifest.map((m) => {
          const st = reconcile(state, m);
          return (
            <div key={m.name} className="tr tr3">
              <span className="dep-name"><span className="pkg-dot"/> {m.name}</span>
              <span className="muted">{m.version} · {m.license}</span>
              <span className={'recon-badge ' + st}>
                {st === 'matched' ? '与入库一致' : st === 'drifted' ? '版本漂移（入库内容已更新）' : '尚无扫描包'}
              </span>
            </div>
          );
        })}
        <div className="manifest-add">
          <input placeholder="包名" value={name} onChange={(e) => setName(e.target.value)}/>
          <input placeholder="声明版本" value={ver} onChange={(e) => setVer(e.target.value)}/>
          <select value={lic} onChange={(e) => setLic(e.target.value as License)}>
            {LICENSES.map((l) => <option key={l}>{l}</option>)}
          </select>
          <button className="primary" onClick={() => {
            if (!name.trim() || !ver.trim()) return;
            actions.upsertManifest(name.trim(), ver.trim(), lic);
            setName(''); setVer('');
          }}>登记/更新声明</button>
        </div>
      </div>
      <p className="now-hint">当前时间：{fmtTime(now)}</p>
    </section>
  );
}
