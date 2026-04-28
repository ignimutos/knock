declare module 'bun:test' {
  export function test(
    name: string,
    options: { timeout?: number },
    fn: () => Promise<void> | void,
  ): void
}
