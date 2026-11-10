export function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isUrlValid(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
