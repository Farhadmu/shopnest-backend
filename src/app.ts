import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { generalLimiter } from "./middlewares/rate-limit.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import routes from "./routes/index";

export function createApp(): Application {
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // allow server-to-server, curl, Postman, or mobile apps without origin
        if (!origin) return callback(null, true);
        const allowed =
          env.CORS_ORIGIN_LIST.includes("*") ||
          env.CORS_ORIGIN_LIST.includes(origin) ||
          origin.includes("localhost") ||
          origin.includes("127.0.0.1") ||
          origin.endsWith(".vercel.app") ||
          origin.endsWith(".onrender.com");
        if (allowed) {
          return callback(null, true);
        }
        // Fallback allow origin to ensure deployed apps don't get blocked
        return callback(null, true);
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use("/uploads", express.static(env.UPLOAD_DIR));

  app.use(env.API_PREFIX, generalLimiter, routes);
  if (env.API_PREFIX !== "/") {
    app.use(generalLimiter, routes);
  }

  app.get("/", (_req, res) => {
    res.status(200).json({ success: true, message: "ShopNest API is running", docs: `${env.API_PREFIX}/health` });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
