/**
 * Semver order (story 4.3 review Q5: the one implementation, used by the
 * launcher and BMad Method's setup status). It imports nothing, so the
 * launcher can load it on its own (`@ogden-agents/shared/semver`).
 */
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Compares two semver versions: negative if `a < b`, 0 if equal, positive if
 * `a > b`, `undefined` if either doesn't parse. A pre-release is lower than
 * its release; build metadata is ignored.
 */
export function compareVersions(a: string, b: string): number | undefined {
  const pa = SEMVER.exec(a.trim());
  const pb = SEMVER.exec(b.trim());
  if (pa === null || pb === null) return undefined;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  const preA = pa[4];
  const preB = pb[4];
  if (preA === undefined || preB === undefined) return preA === preB ? 0 : preA === undefined ? 1 : -1;
  const idsA = preA.split('.');
  const idsB = preB.split('.');
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
    const x = idsA[i];
    const y = idsB[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
