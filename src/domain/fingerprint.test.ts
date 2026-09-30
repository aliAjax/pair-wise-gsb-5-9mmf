import { describe, expect, it } from 'vitest';
import { contentFingerprint, packageKey } from './fingerprint';

describe('内容指纹', () => {
  it('相同内容（即使版本号写法不同）指纹一致', () => {
    const fp1 = contentFingerprint({ name: 'pkg-a', version: '1.0.0', license: 'MIT', contentCode: 'abc' });
    const fp2 = contentFingerprint({ name: 'pkg-a', version: '1.0.1', license: 'MIT', contentCode: 'abc' });
    expect(fp1).toBe(fp2);
  });

  it('内容一变指纹即变，即使版本号相同', () => {
    const fp1 = contentFingerprint({ name: 'pkg-a', version: '1.0.0', license: 'MIT', contentCode: 'abc' });
    const fp2 = contentFingerprint({ name: 'pkg-a', version: '1.0.0', license: 'MIT', contentCode: 'abd' });
    expect(fp1).not.toBe(fp2);
  });

  it('许可证不同指纹不同', () => {
    const fp1 = contentFingerprint({ name: 'pkg-a', version: '1.0.0', license: 'MIT', contentCode: 'abc' });
    const fp2 = contentFingerprint({ name: 'pkg-a', version: '1.0.0', license: 'GPL-3.0', contentCode: 'abc' });
    expect(fp1).not.toBe(fp2);
  });

  it('指纹稳定可重复计算', () => {
    const input = { name: 'React', version: '18.3.1', license: 'MIT', contentCode: 'x' };
    expect(contentFingerprint(input)).toBe(contentFingerprint(input));
    expect(contentFingerprint(input)).toMatch(/^cfp:[0-9a-f]{16}$/);
  });

  it('包名大小写归一', () => {
    expect(packageKey(' React ')).toBe('react');
  });
});
