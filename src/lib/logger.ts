/**
 * Structured JSON logs. Values under sensitive keys are redacted and URLs
 * lose their query string (signed links). Never log media or prompts.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE = /(key|token|secret|password|authorization|cookie|signature|prompt|text|email)/i;

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") {
    return value.replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?[redacted]").slice(0, 500);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: sanitize(value.message, depth + 1) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    return out;
  }
  return value;
}

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(sanitize(fields ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
