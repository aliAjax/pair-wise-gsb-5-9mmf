// 内容指纹：对“包内容”做确定性哈希。
// 真实离线扫描器会对 tarball 的文件清单+逐文件内容做哈希；这里以
// contentCode 作为包内容的摘要输入。相同内容（无论版本号怎么写）→ 同一指纹，
// 不同内容（即使版本号相同）→ 不同指纹。

// FNV-1a 64-bit，用双 32 位精度实现，输出 16 位十六进制。
const FNV_OFFSET_LOW = 0xcbf29ce4;
const FNV_PRIME_LOW = 0x01000193;
const FNV_OFFSET_HIGH = 0x84222325;

const MASK = 0xffffffff;

function fnv1a64(input: string): string {
  let low = FNV_OFFSET_LOW >>> 0;
  let high = FNV_OFFSET_HIGH >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    // low ^= c; 64-bit 乘 prime = (high*prime<<32) + (low*prime)
    low ^= c;
    const lowProduct = low * FNV_PRIME_LOW; // 32-bit multiply，JS 精确到 53 bit
    const highCarry = Math.floor(lowProduct / 0x100000000);
    const lowResult = lowProduct >>> 0;
    high = (Math.imul(high, FNV_PRIME_LOW) + highCarry) >>> 0;
    low = lowResult;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(high)}${hex(low)}`;
}

export interface FingerprintInput {
  name: string;
  version: string;
  license: string;
  contentCode: string;
}

export function contentFingerprint(p: FingerprintInput): string {
  // 版本号不参与内容哈希：版本号只是标签，内容才是本体。
  const canonical = `pkg:${p.name}|lic:${p.license}|content:${p.contentCode}`;
  return 'cfp:' + fnv1a64(canonical);
}

/** 包逻辑键（同一名称的包视为同包的不同内容代） */
export function packageKey(name: string): string {
  return name.trim().toLowerCase();
}

export function shortFp(fp: string): string {
  return fp.slice(0, 13) + '…';
}
