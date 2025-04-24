// server/index.ts

console.log('>>> RUNNING [server/index.ts]');

import express, { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { registerRoutes } from "./routes";
// If you have Vite setup files, keep these imports:
import { setupVite, serveStatic, log } from "./vite";

// --- Setup __dirname for ES modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Setup Express ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Response Logging Middleware ---
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

// --- Webhook Handler ---
const CALLS_FILE_PATH = path.join(process.cwd(), "calls.json");
function ensureCallsFile() {
  if (!fs.existsSync(CALLS_FILE_PATH)) {
    fs.writeFileSync(CALLS_FILE_PATH, "[]");
    console.log('📄 Created new calls.json at', CALLS_FILE_PATH);
  }
}
function saveCallEvent(event: any) {
  ensureCallsFile();
  let calls = [];
  try {
    calls = JSON.parse(fs.readFileSync(CALLS_FILE_PATH, "utf-8"));
  } catch (err) {
    console.error("❌ Failed to read calls.json, resetting:", err);
    calls = [];
  }
  calls.push(event);
  fs.writeFileSync(CALLS_FILE_PATH, JSON.stringify(calls, null, 2));
  console.log("✅ Saved call event. Total calls:", calls.length);
}

app.post("/api/webhook", (req: Request, res: Response) => {
  console.log("🔥 [Webhook Received] Payload:", JSON.stringify(req.body, null, 2));
  saveCallEvent(req.body);
  res.status(200).json({ status: "ok", message: "Webhook received and saved!" });
});

// --- Health Check Endpoint ---
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", msg: "server/index.ts is running." });
});

// --- Register the rest of your routes ---
registerRoutes(app);

(async () => {
  // Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Setup Vite in dev, serve static in prod
  if (app.get("env") === "development") {
    await setupVite(app);
  } else {
    serveStatic(app);
  }

  const port = 5000;
  app.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
