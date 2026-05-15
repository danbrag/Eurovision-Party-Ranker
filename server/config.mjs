import path from "node:path";

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

export const config = {
  port: Number(process.env.PORT || 3000),
  roomCode: (process.env.ROOM_CODE || "ILOVEDAN").trim().toUpperCase(),
  adminPin: process.env.ADMIN_PIN || "1234",
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), ".local-data"),
  watcherEnabled: process.env.OFFICIAL_WATCH_ENABLED === "true",
  watcherIntervalMs: Number(process.env.OFFICIAL_WATCH_INTERVAL_MS || 45_000)
};
