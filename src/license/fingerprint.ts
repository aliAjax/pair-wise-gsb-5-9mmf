import type {ScanItem} from './types';

/**
 * cyrb53 —— 确定性的 53 位非加密哈希。
 * 同一内容（名称/版本/许可证/包体签名）永远得到同一指纹，
 * 包体签名一变，指纹就变。
 */
export function cyrb53(str: string, seed = 7): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(13, '0');
}

export function contentFingerprint(input: {
  name: string;
  version: string;
  license: string | null;
  filesSignature?: string;
}): string {
  const body = JSON.stringify({
    n: input.name.trim().toLowerCase(),
    v: input.version.trim(),
    l: input.license ?? '__UNKNOWN__',
    f: input.filesSignature ?? '__NO_BODY_SIG__',
  });
  return 'fp_' + cyrb53(body);
}

export function fingerprintOf(item: Pick<ScanItem, 'name' | 'version' | 'license' | 'filesSignature' | 'fingerprint'>): string {
  return item.fingerprint ?? contentFingerprint(item);
}

export function coord(name: string, version: string): string {
  return `${name.trim()}@${version.trim()}`;
}
