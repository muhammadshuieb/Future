import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type Role = "admin" | "manager" | "accountant" | "viewer";

export type JwtPayload = {
  sub: string;
  name?: string;
  email: string;
  role: Role;
  tenantId: string;
  permissions?: Record<string, boolean>;
  walletBalance?: number;
};

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.auth = decoded;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (req.auth.role === "admin" || roles.includes(req.auth.role)) {
      next();
      return;
    }
    res.status(403).json({ error: "forbidden" });
  };
}
