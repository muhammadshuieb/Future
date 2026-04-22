import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type SubscriberJwtPayload = {
  kind: "subscriber";
  sub: string;
  tenantId: string;
  username: string;
};

declare global {
  namespace Express {
    interface Request {
      subscriber?: SubscriberJwtPayload;
    }
  }
}

export function requireSubscriberAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as SubscriberJwtPayload;
    if (decoded.kind !== "subscriber") {
      res.status(403).json({ error: "not_subscriber_token" });
      return;
    }
    req.subscriber = decoded;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
