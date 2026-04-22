import type { NextFunction, Request, Response } from "express";
import { requestHasManagerPermission, type ManagerPermissionKey } from "../lib/manager-permissions.js";

type Role = "admin" | "manager" | "accountant" | "viewer";

type RoutePolicyOptions = {
  allow: Role[];
  managerPermission?: ManagerPermissionKey;
  allowAccountantWrite?: boolean;
  allowViewerWrite?: boolean;
};

function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/**
 * Unified policy middleware for route-level authorization checks.
 */
export function routePolicy(options: RoutePolicyOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.auth?.role as Role | undefined;
    if (!role) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!options.allow.includes(role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const readOnly = isReadOnlyMethod(req.method);
    if (!readOnly) {
      if (role === "viewer" && !options.allowViewerWrite) {
        res.status(403).json({ error: "viewer_read_only" });
        return;
      }
      if (role === "accountant" && !options.allowAccountantWrite) {
        res.status(403).json({ error: "accountant_read_only_non_billing" });
        return;
      }
    }

    if (role === "manager" && options.managerPermission) {
      if (!requestHasManagerPermission(req, options.managerPermission)) {
        res.status(403).json({ error: "forbidden", detail: "missing_manager_permission" });
        return;
      }
    }
    next();
  };
}
