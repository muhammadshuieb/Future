import rateLimit from "express-rate-limit";

const windowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? `${15 * 60 * 1000}`, 10);
const max = parseInt(process.env.LOGIN_RATE_LIMIT_MAX ?? "40", 10);

/** Shared limiter for staff / subscriber login (per IP). */
export const loginRateLimiter = rateLimit({
  windowMs,
  max: Math.max(5, max),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
  // Do not throw if a proxy adds X-Forwarded-For before Express trust proxy runs (defense in depth).
  validate: { xForwardedForHeader: false },
});
