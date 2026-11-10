/**
 * Whether an error message may be shown to a client.
 *
 * 5xx messages often carry paths, driver text or Redis details. In production
 * they are replaced with a generic message; development and 4xx validation
 * messages stay intact so operators can debug and callers can fix requests.
 */
export function publicErrorMessage(message: string, status: number, env: string): string {
  if (status >= 500 && env === "production") return "Internal server error";
  return message;
}
