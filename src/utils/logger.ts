/* Small dependency-free structured logger. Swap for pino/winston later if needed. */
type Level = "info" | "warn" | "error" | "debug";

function line(level: Level, msg: string, meta?: unknown) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (meta !== undefined) {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](base, meta);
  } else {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](base);
  }
}

export const logger = {
  info: (msg: string, meta?: unknown) => line("info", msg, meta),
  warn: (msg: string, meta?: unknown) => line("warn", msg, meta),
  error: (msg: string, meta?: unknown) => line("error", msg, meta),
  debug: (msg: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== "production") line("debug", msg, meta);
  },
};
