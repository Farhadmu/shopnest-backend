import { createApp } from "./app";
import { connectDB } from "./config/db";
import { env } from "./config/env";
import { logger } from "./utils/logger";

async function bootstrap() {
  await connectDB();

  const app = createApp();

  const server = app.listen(env.PORT, "0.0.0.0", () => {
    logger.info(`ShopNest API listening on port ${env.PORT} (${env.NODE_ENV})`);
    logger.info(`Base URL: http://localhost:${env.PORT}${env.API_PREFIX}`);
    if (!env.IS_AI_ENABLED) {
      logger.warn("No AI provider key is configured - text AI endpoints will return a configuration error until ANTHROPIC_API_KEY or GEMINI_API_KEY is set");
    }
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", reason);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
