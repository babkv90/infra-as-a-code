import rateLimit from 'express-rate-limit';

// Tighter, per-user limit specifically for the secret-reveal endpoint. The global limiter in app.js
// covers the whole API at a generous window, which is fine for normal usage but isn't tuned to stop
// a script hammering this one endpoint to harvest credentials field-by-field. Keyed by user id (this
// route always sits behind requireAuth, so req.user is always set) rather than IP, per-user as the
// task asked for, not per-connection.
export const secretRevealRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() ?? req.ip,
  message: { success: false, message: 'Too many secret reveal requests. Try again in a few minutes.' },
});
