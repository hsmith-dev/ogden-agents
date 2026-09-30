/** Types for `pack.mjs` (the fake Claude Agent ACP adapter for the install tests, story 9.3). */
export declare function testNpmCli(): string;
export declare function packFakeAdapter(
  dir: string,
  options?: { npmCli?: string },
): {
  tarball: string;
  pins: {
    packageJson: unknown;
    lock: { lockfileVersion: number; packages: Record<string, { version?: string; resolved?: string; integrity?: string }> };
  };
  version: string;
  npmCli: string;
};
