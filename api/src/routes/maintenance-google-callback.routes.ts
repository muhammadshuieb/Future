import { Router } from "express";
import { completeGoogleDriveOAuthCallback } from "../services/backup.service.js";
import { inferApiPublicOrigin, inferReturnFrontendOrigin } from "../lib/public-origin.js";

const router = Router();

/**
 * Google OAuth redirect target (no JWT — validated via signed `state`).
 */
router.get("/rclone/google/callback", async (req, res) => {
  const apiOrigin = inferApiPublicOrigin(req);
  const baseDefault = inferReturnFrontendOrigin(req, apiOrigin);
  const fail = (code: string, returnBase: string) => {
    const b = returnBase.replace(/\/+$/, "");
    res.redirect(`${b}/maintenance?gdrive=${encodeURIComponent(code)}`);
  };
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
      fail("missing_code", baseDefault);
      return;
    }
    const { returnBase: okBase } = await completeGoogleDriveOAuthCallback({ code, state });
    const b = okBase.replace(/\/+$/, "");
    res.redirect(`${b}/maintenance?gdrive=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth_failed";
    console.error("gdrive oauth callback", e);
    fail(msg.slice(0, 120), baseDefault);
  }
});

export default router;
