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

/**
 * `stable` for a release, `preview` for a pre-release (rc, next); `undefined` when it doesn't parse.
 *
 * UNRESOLVED (2026-10-07): this reads *any* hyphen as a pre-release marker, which was true of classic
 * semver's optional `-rc.1`/`-beta.2` style, but every continuous date-based version (`YYYY.M.D-N`,
 * RELEASING.md) now carries a hyphen as a *mandatory* sequence number, not a pre-release marker — so as
 * written, every future release classifies as "preview", never "stable". See RELEASING.md, "Releasing,
 * going forward" > "The stable/preview channel question" for what actually depends on this, the options
 * considered, and a recommendation. Not decided; do not treat "preview" here as intentional until that
 * section says so.
 */
export function channelOf(version: string): 'stable' | 'preview' | undefined {
  const parsed = SEMVER.exec(version.trim());
  if (parsed === null) return undefined;
  return parsed[4] === undefined ? 'stable' : 'preview';
}

/** The npm dist-tags the update notice reads, and the version a tag offers. */
export interface UpdateOffer {
  version: string;
  tag: 'latest' | 'next';
  source: 'github-releases' | 'npm';
}

/**
 * The newer version `current` is told about, or `null` (story 13.7). A stable
 * version hears only of a newer stable, the `latest` tag. A pre-release hears
 * of the highest newer version among `latest` and `next`. A tag that doesn't
 * parse, or an unparsable `current`, offers nothing.
 */
export function decideUpdate(current: string, tags: Readonly<Record<string, string>>, source: UpdateOffer['source'] = 'npm'): UpdateOffer | null {
  const channel = channelOf(current);
  if (channel === undefined) return null;
  let best: UpdateOffer | null = null;
  for (const tag of channel === 'stable' ? (['latest'] as const) : (['latest', 'next'] as const)) {
    const version = tags[tag];
    if (typeof version !== 'string') continue;
    if (channel === 'stable' && channelOf(version) !== 'stable') continue;
    if ((compareVersions(version, current) ?? 0) <= 0) continue;
    if (best === null || (compareVersions(version, best.version) ?? 0) > 0) best = { version: version.trim().replace(/^v/, ''), tag, source };
  }
  return best;
}
