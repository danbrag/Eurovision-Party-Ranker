import express from "express";
import http from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import { config, EVENT } from "./config.mjs";
import {
  getState,
  joinParticipant,
  openDatabase,
  releaseParticipantName,
  resetRoom,
  setRankings,
  setReveal,
  setScore,
  updateOfficialResult
} from "./db.mjs";
import { OfficialWatcher } from "./officialWatcher.mjs";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = openDatabase();

const broadcast = (state = getState(db, config.roomCode)) => {
  io.to(config.roomCode).emit("state:update", state);
};
const watcher = new OfficialWatcher(db, broadcast);
if (config.watcherEnabled) watcher.start();

app.use(express.json({ limit: "1mb" }));

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      res.status(status).json({ error: error.message || "Something went wrong." });
    }
  };
}

function requireAdmin(req) {
  if (req.body?.adminPin !== config.adminPin) {
    throw Object.assign(new Error("Invalid admin PIN."), { status: 401 });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, watcherRunning: watcher.running });
});

app.get("/api/config", (_req, res) => {
  res.json({
    roomCode: config.roomCode,
    event: EVENT,
    watcherRunning: watcher.running
  });
});

app.get("/api/state", (req, res) => {
  res.json(getState(db, String(req.query.roomCode || config.roomCode).toUpperCase()));
});

app.post(
  "/api/join",
  asyncRoute(async (req, res) => {
    const participant = joinParticipant(db, req.body || {});
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ participant, state });
  })
);

app.post(
  "/api/release-name",
  asyncRoute(async (req, res) => {
    releaseParticipantName(db, req.body || {});
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ ok: true, state });
  })
);

app.post(
  "/api/score",
  asyncRoute(async (req, res) => {
    setScore(db, req.body || {});
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ ok: true, state });
  })
);

app.post(
  "/api/rankings",
  asyncRoute(async (req, res) => {
    setRankings(db, req.body || {});
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ ok: true, state });
  })
);

app.post(
  "/api/reveal",
  asyncRoute(async (req, res) => {
    requireAdmin(req);
    setReveal(db, { roomCode: config.roomCode, revealed: Boolean(req.body.revealed) });
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ ok: true, state });
  })
);

app.post(
  "/api/admin/verify",
  asyncRoute(async (req, res) => {
    requireAdmin(req);
    res.json({ ok: true });
  })
);

app.post(
  "/api/admin/official-result",
  asyncRoute(async (req, res) => {
    requireAdmin(req);
    updateOfficialResult(db, req.body.entry || {});
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ ok: true, state });
  })
);

app.post(
  "/api/admin/import-official",
  asyncRoute(async (req, res) => {
    requireAdmin(req);
    const result = await watcher.pullOnce();
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ ok: true, result, state });
  })
);

app.post(
  "/api/admin/watcher",
  asyncRoute(async (req, res) => {
    requireAdmin(req);
    if (req.body.enabled) watcher.start();
    else watcher.stop();
    res.json({ ok: true, watcherRunning: watcher.running });
  })
);

app.post(
  "/api/admin/reset-room",
  asyncRoute(async (req, res) => {
    requireAdmin(req);
    resetRoom(db, { roomCode: config.roomCode });
    const state = getState(db, config.roomCode);
    broadcast(state);
    res.json({ ok: true, state });
  })
);

io.on("connection", (socket) => {
  socket.join(config.roomCode);
  socket.emit("state:update", getState(db, config.roomCode));
});

const distPath = path.join(process.cwd(), "dist");
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distPath, "index.html"));
});

server.listen(config.port, () => {
  console.log(`Eurovision rankings app listening on http://localhost:${config.port}`);
});
