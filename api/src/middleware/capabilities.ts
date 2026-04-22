import type { Request, Response, NextFunction } from "express";

/** Blocks accountants from infrastructure / subscriber write routes (billing-only role). */
export function denyAccountant(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role === "accountant") {
    res.status(403).json({ error: "accountant_read_only_non_billing" });
    return;
  }
  next();
}

/** Viewers: read-only (block all mutating HTTP methods). */
export function denyViewerWrites(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== "viewer") {
    next();
    return;
  }
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  res.status(403).json({ error: "viewer_read_only" });
}
