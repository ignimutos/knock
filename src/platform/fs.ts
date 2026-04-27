export function cwd(): string {
  return Deno.cwd()
}

export async function readTextFile(path: string): Promise<string> {
  return await Deno.readTextFile(path)
}

export async function statPath(path: string): Promise<Deno.FileInfo> {
  return await Deno.stat(path)
}
