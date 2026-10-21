/**
 * The few theme values needed OUTSIDE CSS (phone home-screen colour, app icon, PDF ink).
 * Together with src/app/globals.css this is the whole theme; keep them in step.
 */
export const THEME = {
  /** Default brand colour (clinics override it at runtime from their settings). */
  brand: "#28817a",
  brandForeground: "#ffffff",
  background: "#f7f8f8",
  /** Print colour for PDFs. */
  ink: "#111111",
  inkMuted: "#555555",
} as const;
