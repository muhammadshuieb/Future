import type { Request, Response, NextFunction } from "express";
import {
  hasSpeedProfilePermission,
  type SpeedProfilePermissionKey,
} from "../lib/speed-profile-permissions.js";

export function requireSpeedProfilePermission(key: SpeedProfilePermissionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (hasSpeedProfilePermission(req.auth.role, req.auth.permissions, key)) {
      next();
      return;
    }
    res.status(403).json({ error: "forbidden" });
  };
}
