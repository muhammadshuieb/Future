import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type ResellerPortalJwtPayload = {
  kind: "reseller_user";
  sub: string;
  resellerId: string;
  tenantId: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      resellerUser?: ResellerPortalJwtPayload;
    }
  }
}

export function requireResellerPortalAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as ResellerPortalJwtPayload;
    if (decoded.kind !== "reseller_user") {
      res.status(403).json({ error: "not_reseller_token" });
      return;
    }
    req.resellerUser = decoded;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
