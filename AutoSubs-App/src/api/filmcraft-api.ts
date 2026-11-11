import { invoke } from "@tauri-apps/api/core";

export class FilmcraftExportError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "FilmcraftExportError";
  }
}

export async function filmcraftCommand<T = unknown>(
  token: string,
  command: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return invoke<T>("filmcraft_request", {
    token,
    method: "engine.execute",
    params: { command, params },
  });
}
