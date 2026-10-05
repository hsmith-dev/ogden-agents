/** `promise`, or a rejection with `error()` after `ms`; the timer is cleared either way. */
export function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(error()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
