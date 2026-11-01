/**
 * A planted-program fixture for the launch rule (`program-launch.ts`, 8.12;
 * POSIX only): a real program in an absolute `bin` folder that runs a bare
 * `helper` and then prints its answer, and a `work` folder holding a planted
 * `helper` (reached through an empty PATH entry, which means the working
 * folder) and `rel/helper` (reached through the relative entry `rel`). The
 * planted ones write `ran` to `marker`; the rule holds while `marker` never
 * appears.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PlantedProgram {
  root: string;
  /** The absolute folder that holds the real program. */
  bin: string;
  /** The working folder: the planted `helper` and `rel/helper`. */
  work: string;
  /** Written only if a planted program ran. */
  marker: string;
  /** `PATH` values that reach a planted `helper`: one with an empty entry, one with a relative entry. */
  paths: { empty: string; relative: string };
  ran(): boolean;
  remove(): void;
}

const script = (path: string, body: string) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

/** `program` in `bin` runs `helper`, then prints `answer`. */
export function plantedProgram(program: string, answer: string): PlantedProgram {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-planted-')));
  const bin = join(root, 'bin');
  const work = join(root, 'work');
  const marker = join(root, 'marker');
  mkdirSync(bin);
  mkdirSync(join(work, 'rel'), { recursive: true });
  script(join(bin, program), `helper >/dev/null 2>&1\necho "${answer}"`);
  for (const planted of [join(work, 'helper'), join(work, 'rel', 'helper')]) script(planted, `echo ran > "${marker}"`);
  return {
    root,
    bin,
    work,
    marker,
    paths: { empty: `${bin}::`, relative: `${bin}:rel` },
    ran: () => existsSync(marker),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
