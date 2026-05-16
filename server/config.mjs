import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export const EVENT = {
  year: 2026,
  city: "Vienna",
  grandFinalIso: "2026-05-16T21:00:00+02:00",
  grandFinalEastern: "2026-05-16T15:00:00-04:00",
  officialGrandFinalUrl:
    "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/",
  officialAllParticipantsUrl:
    "https://www.eurovision.com/eurovision-song-contest/vienna-2026/all-participants/",
  firstSemiUrl:
    "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-semi-final/",
  secondSemiUrl:
    "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-second-semi-final/"
};

const isProduction = process.env.NODE_ENV === "production";
const defaultAdminPin = isProduction ? "" : "1234";
const adminPin = String(process.env.ADMIN_PIN || defaultAdminPin).trim();
const unsafeProductionPins = new Set(["", "1234", "change-this-before-deploying", "use-a-real-private-pin"]);

export const config = {
  port: Number(process.env.PORT || 3000),
  roomCode: (process.env.ROOM_CODE || "EUROVISION").trim().toUpperCase(),
  adminPin: isProduction && unsafeProductionPins.has(adminPin) ? "" : adminPin,
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), ".local-data"),
  maxParticipants: Math.max(1, Number(process.env.MAX_PARTICIPANTS || 6) || 6),
  watcherEnabled: process.env.OFFICIAL_WATCH_ENABLED === "true",
  watcherIntervalMs: Number(process.env.OFFICIAL_WATCH_INTERVAL_MS || 45_000)
};
