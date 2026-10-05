type Choice = 'other_agent' | 'install_docker' | 'attended';

/** A fixed sandbox answer with the status that agrees (story 5.6). */
export const fixedSandbox = (check: { available: true; kind: string } | { available: false; reason: string; choices?: Choice[] }) => ({
  check: async () => check,
  status: async () => (check.available
    ? { platform: 'other' as const, available: true, kind: check.kind, summary: 'ok', probes: [], choices: [], installHint: null }
    : { platform: 'other' as const, available: false, kind: null, summary: check.reason, probes: [], choices: check.choices ?? ['other_agent', 'install_docker', 'attended'], installHint: null }),
});

