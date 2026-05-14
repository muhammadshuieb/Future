import type { NextFunction, Request, Response } from "express";
import { httpRequestDurationSeconds, httpRequestsTotal } from "../services/metrics.service.js";

/**
 * Records HTTP request count and latency in Prometheus.
 *
 * `req.route?.path` is preferred over `req.path` to keep label cardinality bounded:
 * `/api/subscribers/:id` (one label) instead of one label per real id.
 *
 * Routes not matched (404, body parsing errors before route resolution) fall back to a
 * stable bucket label so we don't flood the registry.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/metrics" || req.path === "/health") {
    next();
    return;
  }
  const end = httpRequestDurationSeconds.startTimer();
  res.on("finish", () => {
    const routePath = (req.route?.path as string | undefined) ?? "";
    const baseUrl = req.baseUrl || "";
    const route = (baseUrl + routePath) || req.path || "unmatched";
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}
