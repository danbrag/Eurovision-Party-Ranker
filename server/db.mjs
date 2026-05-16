import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.mjs";

const now = () => new Date().toISOString();
const bool = (value) => (value ? 1 : 0);
const fromBool = (value) => Boolean(value);

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 30);
}

function entryFromRow(row) {
  return {
    id: row.id,
    country: row.country,
    countryCode: row.country_code,
    artist: row.artist,
    song: row.song,
    youtubeUrl: row.youtube_url,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    artistBio: row.artist_bio,
    artistAge: row.artist_age,
    semifinal: row.semifinal,
    semifinalOrder: row.semifinal_order,
    isAutomaticFinalist: fromBool(row.is_automatic_finalist),
    isGrandFinalist: fromBool(row.is_grand_finalist),
    grandFinalOrder: row.grand_final_order,
    finalPlace: row.final_place,
    officialTotalPoints: row.official_total_points,
    officialJuryPoints: row.official_jury_points,
    officialAudiencePoints: row.official_audience_points,
    officialUpdatedAt: row.official_updated_at,
    updatedAt: row.updated_at
  };
}

function participantFromRow(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    claimedAt: row.claimed_at,
    lastSeen: row.last_seen
  };
}

export function openDatabase() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dbPath = path.join(config.dataDir, "eurovision.sqlite");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      country_code TEXT,
      artist TEXT NOT NULL,
      song TEXT NOT NULL,
      youtube_url TEXT,
      detail_url TEXT,
      image_url TEXT,
      artist_bio TEXT,
      artist_age INTEGER,
      semifinal TEXT,
      semifinal_order INTEGER,
      is_automatic_finalist INTEGER NOT NULL DEFAULT 0,
      is_grand_finalist INTEGER NOT NULL DEFAULT 0,
      grand_final_order INTEGER,
      final_place INTEGER,
      official_total_points INTEGER,
      official_jury_points INTEGER,
      official_audience_points INTEGER,
      official_updated_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      room_code TEXT PRIMARY KEY,
      reveal_locked INTEGER NOT NULL DEFAULT 0,
      revealed INTEGER NOT NULL DEFAULT 0,
      event_status TEXT NOT NULL DEFAULT 'preview',
      data_updated_at TEXT NOT NULL,
      official_updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      display_name TEXT NOT NULL,
      display_name_lower TEXT NOT NULL,
      browser_token TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(room_code, display_name_lower),
      FOREIGN KEY(room_code) REFERENCES rooms(room_code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scores (
      room_code TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      enjoyment_score REAL,
      prediction_score REAL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(room_code, participant_id, entry_id),
      FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE,
      FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rankings (
      room_code TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      submitted_at TEXT NOT NULL,
      PRIMARY KEY(room_code, participant_id, entry_id),
      FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE,
      FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS official_votes (
      entry_id TEXT NOT NULL,
      source_country TEXT NOT NULL,
      vote_type TEXT NOT NULL,
      points INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(entry_id, source_country, vote_type),
      FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );
  `);

  ensureScoreSchema(db);
  ensureRoom(db, config.roomCode);
  seedIfEmpty(db);
  return db;
}

function ensureScoreSchema(db) {
  const columns = db.prepare("PRAGMA table_info(scores)").all().map((column) => column.name);
  if (columns.includes("enjoyment_score") && columns.includes("prediction_score")) return;

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE scores_next (
        room_code TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        enjoyment_score REAL,
        prediction_score REAL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(room_code, participant_id, entry_id),
        FOREIGN KEY(participant_id) REFERENCES participants(id) ON DELETE CASCADE,
        FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
      );
    `);

    if (columns.includes("score")) {
      db.exec(`
        INSERT INTO scores_next (
          room_code, participant_id, entry_id, enjoyment_score, prediction_score, updated_at
        )
        SELECT room_code, participant_id, entry_id, score, NULL, updated_at
        FROM scores;
      `);
    } else {
      const enjoymentColumn = columns.includes("enjoyment_score") ? "enjoyment_score" : "NULL";
      const predictionColumn = columns.includes("prediction_score") ? "prediction_score" : "NULL";
      db.exec(`
        INSERT INTO scores_next (
          room_code, participant_id, entry_id, enjoyment_score, prediction_score, updated_at
        )
        SELECT room_code, participant_id, entry_id, ${enjoymentColumn}, ${predictionColumn}, updated_at
        FROM scores;
      `);
    }

    db.exec("DROP TABLE scores");
    db.exec("ALTER TABLE scores_next RENAME TO scores");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function ensureRoom(db, roomCode) {
  const code = String(roomCode || config.roomCode).trim().toUpperCase();
  db.prepare(
    `INSERT INTO rooms (room_code, data_updated_at)
     VALUES (?, ?)
     ON CONFLICT(room_code) DO NOTHING`
  ).run(code, now());
  return code;
}

function seedIfEmpty(db) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM entries").get().count;
  if (count > 0) return;

  const seedPath = path.join(process.cwd(), "server", "seed", "entries.json");
  if (!fs.existsSync(seedPath)) return;
  const entries = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  upsertEntries(db, entries);
}

export function upsertEntries(db, entries) {
  const stamp = now();
  const stmt = db.prepare(`
    INSERT INTO entries (
      id, country, country_code, artist, song, youtube_url, detail_url,
      image_url, artist_bio, artist_age, semifinal, semifinal_order,
      is_automatic_finalist, is_grand_finalist, grand_final_order,
      final_place, official_total_points, official_jury_points,
      official_audience_points, official_updated_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      country = excluded.country,
      country_code = COALESCE(excluded.country_code, entries.country_code),
      artist = excluded.artist,
      song = excluded.song,
      youtube_url = COALESCE(excluded.youtube_url, entries.youtube_url),
      detail_url = COALESCE(excluded.detail_url, entries.detail_url),
      image_url = COALESCE(excluded.image_url, entries.image_url),
      artist_bio = COALESCE(excluded.artist_bio, entries.artist_bio),
      artist_age = COALESCE(excluded.artist_age, entries.artist_age),
      semifinal = COALESCE(excluded.semifinal, entries.semifinal),
      semifinal_order = COALESCE(excluded.semifinal_order, entries.semifinal_order),
      is_automatic_finalist = excluded.is_automatic_finalist,
      is_grand_finalist = excluded.is_grand_finalist,
      grand_final_order = COALESCE(excluded.grand_final_order, entries.grand_final_order),
      final_place = COALESCE(excluded.final_place, entries.final_place),
      official_total_points = COALESCE(excluded.official_total_points, entries.official_total_points),
      official_jury_points = COALESCE(excluded.official_jury_points, entries.official_jury_points),
      official_audience_points = COALESCE(excluded.official_audience_points, entries.official_audience_points),
      official_updated_at = COALESCE(excluded.official_updated_at, entries.official_updated_at),
      updated_at = excluded.updated_at
  `);

  db.exec("BEGIN");
  try {
    for (const entry of entries) {
      stmt.run(
        entry.id,
        entry.country,
        entry.countryCode || null,
        entry.artist,
        entry.song,
        entry.youtubeUrl || null,
        entry.detailUrl || null,
        entry.imageUrl || null,
        entry.artistBio || null,
        entry.artistAge || null,
        entry.semifinal || null,
        entry.semifinalOrder || null,
        bool(entry.isAutomaticFinalist),
        bool(entry.isGrandFinalist),
        entry.grandFinalOrder || null,
        entry.finalPlace || null,
        entry.officialTotalPoints ?? null,
        entry.officialJuryPoints ?? null,
        entry.officialAudiencePoints ?? null,
        entry.officialUpdatedAt || null,
        stamp
      );
    }
    db.prepare("UPDATE rooms SET data_updated_at = ? WHERE room_code = ?").run(
      stamp,
      config.roomCode
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getState(db, roomCode = config.roomCode) {
  const code = ensureRoom(db, roomCode);
  const room = db
    .prepare("SELECT * FROM rooms WHERE room_code = ?")
    .get(code);
  const entries = db
    .prepare(
      `SELECT * FROM entries
       ORDER BY
         CASE WHEN grand_final_order IS NULL THEN 999 ELSE grand_final_order END,
         country COLLATE NOCASE ASC`
    )
    .all()
    .map(entryFromRow);
  const participants = db
    .prepare(
      `SELECT id, display_name, claimed_at, last_seen
       FROM participants WHERE room_code = ?
       ORDER BY claimed_at ASC`
    )
    .all(code)
    .map(participantFromRow);
  const scores = db
    .prepare(
      `SELECT
        participant_id AS participantId,
        entry_id AS entryId,
        enjoyment_score AS enjoymentScore,
        enjoyment_score AS score,
        prediction_score AS predictionScore
       FROM scores WHERE room_code = ?`
    )
    .all(code);
  const rankings = db
    .prepare("SELECT participant_id AS participantId, entry_id AS entryId, rank, submitted_at AS submittedAt FROM rankings WHERE room_code = ?")
    .all(code);
  const officialVotes = db
    .prepare(
      `SELECT entry_id AS entryId, source_country AS sourceCountry, vote_type AS voteType, points
       FROM official_votes ORDER BY vote_type, source_country`
    )
    .all();

  return {
    room: {
      roomCode: room.room_code,
      revealLocked: fromBool(room.reveal_locked),
      revealed: fromBool(room.revealed),
      eventStatus: room.event_status,
      dataUpdatedAt: room.data_updated_at,
      officialUpdatedAt: room.official_updated_at
    },
    entries,
    participants,
    scores,
    rankings,
    officialVotes
  };
}

export function joinParticipant(db, { roomCode, displayName, browserToken }) {
  const code = ensureRoom(db, roomCode);
  const name = normalizeName(displayName);
  const token = String(browserToken || "").trim();
  if (!name) throw Object.assign(new Error("Pick a display name."), { status: 400 });
  if (!token) throw Object.assign(new Error("Missing browser token."), { status: 400 });

  const lower = name.toLowerCase();
  const existing = db
    .prepare("SELECT * FROM participants WHERE room_code = ? AND display_name_lower = ?")
    .get(code, lower);

  if (existing) {
    if (existing.browser_token !== token) {
      const lastSeenMs = Date.parse(existing.last_seen || existing.claimed_at);
      const staleClaim = Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs > 10 * 60 * 1000;
      const roomIsStillSmall =
        db
          .prepare("SELECT COUNT(*) AS count FROM participants WHERE room_code = ?")
          .get(code).count <= config.maxParticipants;
      if (!staleClaim || !roomIsStillSmall) {
        throw Object.assign(new Error(`${name} is already claimed on another device.`), {
          status: 409
        });
      }
      db.prepare("UPDATE participants SET browser_token = ?, last_seen = ? WHERE id = ?").run(
        token,
        now(),
        existing.id
      );
      return participantFromRow({ ...existing, browser_token: token, last_seen: now() });
    }
    db.prepare("UPDATE participants SET last_seen = ? WHERE id = ?").run(now(), existing.id);
    return participantFromRow(existing);
  }

  const count = db
    .prepare("SELECT COUNT(*) AS count FROM participants WHERE room_code = ?")
    .get(code).count;
  if (count >= config.maxParticipants) {
    throw Object.assign(new Error(`This room already has ${config.maxParticipants} people.`), { status: 409 });
  }

  const id = crypto.randomUUID();
  const stamp = now();
  db.prepare(
    `INSERT INTO participants
      (id, room_code, display_name, display_name_lower, browser_token, claimed_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, code, name, lower, token, stamp, stamp);

  return { id, displayName: name, claimedAt: stamp, lastSeen: stamp };
}

export function releaseParticipantName(db, { roomCode, displayName }) {
  const code = ensureRoom(db, roomCode);
  const name = normalizeName(displayName);
  if (!name) throw Object.assign(new Error("Pick a display name to release."), { status: 400 });
  const lower = name.toLowerCase();
  db.prepare("DELETE FROM participants WHERE room_code = ? AND display_name_lower = ?").run(
    code,
    lower
  );
}

export function resetRoom(db, { roomCode }) {
  const code = ensureRoom(db, roomCode);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM scores WHERE room_code = ?").run(code);
    db.prepare("DELETE FROM rankings WHERE room_code = ?").run(code);
    db.prepare("DELETE FROM participants WHERE room_code = ?").run(code);
    db.prepare(
      "UPDATE rooms SET revealed = 0, reveal_locked = 0, event_status = 'preview' WHERE room_code = ?"
    ).run(code);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function requireParticipant(db, { roomCode, participantId, browserToken }) {
  const participant = db
    .prepare("SELECT * FROM participants WHERE room_code = ? AND id = ?")
    .get(roomCode, participantId);
  if (!participant || participant.browser_token !== browserToken) {
    throw Object.assign(new Error("Your session is not recognized for this room."), {
      status: 401
    });
  }
  db.prepare("UPDATE participants SET last_seen = ? WHERE id = ?").run(now(), participant.id);
  return participant;
}

function validateScoreValue(score, label) {
  if (score == null) return null;
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0 || value > 12 || value * 4 !== Math.round(value * 4)) {
    throw Object.assign(new Error(`${label} scores must use quarter-point steps from 0 to 12.`), {
      status: 400
    });
  }
  return value;
}

export function setScore(db, { roomCode, participantId, browserToken, entryId, score, scoreType, enjoymentScore, predictionScore }) {
  const code = ensureRoom(db, roomCode);
  requireParticipant(db, { roomCode: code, participantId, browserToken });
  const nextEnjoyment = validateScoreValue(
    enjoymentScore ?? (scoreType === "enjoyment" || !scoreType ? score : null),
    "Enjoyment"
  );
  const nextPrediction = validateScoreValue(
    predictionScore ?? (scoreType === "prediction" ? score : null),
    "Judges"
  );
  if (nextEnjoyment == null && nextPrediction == null) {
    throw Object.assign(new Error("Pick an enjoyment or judges score to save."), { status: 400 });
  }
  const exists = db.prepare("SELECT 1 FROM entries WHERE id = ?").get(entryId);
  if (!exists) throw Object.assign(new Error("Unknown entry."), { status: 404 });
  db.prepare(
    `INSERT INTO scores (
       room_code, participant_id, entry_id, enjoyment_score, prediction_score, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_code, participant_id, entry_id)
     DO UPDATE SET
       enjoyment_score = COALESCE(excluded.enjoyment_score, scores.enjoyment_score),
       prediction_score = COALESCE(excluded.prediction_score, scores.prediction_score),
       updated_at = excluded.updated_at`
  ).run(code, participantId, entryId, nextEnjoyment, nextPrediction, now());
}

export function setRankings(db, { roomCode, participantId, browserToken, rankings }) {
  const code = ensureRoom(db, roomCode);
  requireParticipant(db, { roomCode: code, participantId, browserToken });
  if (!Array.isArray(rankings) || rankings.length === 0) {
    throw Object.assign(new Error("Submit a complete ranking list."), { status: 400 });
  }
  const ranks = new Set(rankings.map((item) => Number(item.rank)));
  const entries = new Set(rankings.map((item) => item.entryId));
  if (ranks.size !== rankings.length || entries.size !== rankings.length) {
    throw Object.assign(new Error("Rankings cannot contain duplicates."), { status: 400 });
  }

  const stamp = now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM rankings WHERE room_code = ? AND participant_id = ?").run(
      code,
      participantId
    );
    const stmt = db.prepare(
      `INSERT INTO rankings (room_code, participant_id, entry_id, rank, submitted_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const item of rankings) {
      stmt.run(code, participantId, item.entryId, Number(item.rank), stamp);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setReveal(db, { roomCode, revealed }) {
  const code = ensureRoom(db, roomCode);
  db.prepare("UPDATE rooms SET revealed = ?, event_status = ? WHERE room_code = ?").run(
    bool(revealed),
    revealed ? "revealed" : "ranking",
    code
  );
}

export function updateOfficialResult(db, entry) {
  const stamp = now();
  db.prepare(
    `UPDATE entries SET
      grand_final_order = ?,
      final_place = ?,
      official_total_points = ?,
      official_jury_points = ?,
      official_audience_points = ?,
      official_updated_at = ?,
      is_grand_finalist = 1,
      updated_at = ?
     WHERE id = ?`
  ).run(
    entry.grandFinalOrder || null,
    entry.finalPlace || null,
    entry.officialTotalPoints ?? null,
    entry.officialJuryPoints ?? null,
    entry.officialAudiencePoints ?? null,
    stamp,
    stamp,
    entry.id
  );
  db.prepare("UPDATE rooms SET official_updated_at = ? WHERE room_code = ?").run(
    stamp,
    config.roomCode
  );
}

export function applyOfficialSnapshot(db, snapshot) {
  let changed = 0;
  const stamp = now();
  db.exec("BEGIN");
  try {
    for (const item of snapshot.entries || []) {
      const current = db.prepare("SELECT * FROM entries WHERE id = ?").get(item.id);
      if (!current) continue;
      const next = {
        grandFinalOrder: item.grandFinalOrder ?? current.grand_final_order,
        finalPlace: item.finalPlace ?? current.final_place,
        officialTotalPoints: item.officialTotalPoints ?? current.official_total_points,
        officialJuryPoints: item.officialJuryPoints ?? current.official_jury_points,
        officialAudiencePoints:
          item.officialAudiencePoints ?? current.official_audience_points
      };
      const hasChange =
        current.grand_final_order !== next.grandFinalOrder ||
        current.final_place !== next.finalPlace ||
        current.official_total_points !== next.officialTotalPoints ||
        current.official_jury_points !== next.officialJuryPoints ||
        current.official_audience_points !== next.officialAudiencePoints ||
        current.is_grand_finalist !== 1;
      if (!hasChange) continue;
      db.prepare(
        `UPDATE entries SET
          grand_final_order = ?,
          final_place = ?,
          official_total_points = ?,
          official_jury_points = ?,
          official_audience_points = ?,
          is_grand_finalist = 1,
          official_updated_at = ?,
          updated_at = ?
         WHERE id = ?`
      ).run(
        next.grandFinalOrder || null,
        next.finalPlace || null,
        next.officialTotalPoints ?? null,
        next.officialJuryPoints ?? null,
        next.officialAudiencePoints ?? null,
        stamp,
        stamp,
        item.id
      );
      changed++;
    }

    if (snapshot.officialVotes?.length) {
      const stmt = db.prepare(
        `INSERT INTO official_votes (entry_id, source_country, vote_type, points, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(entry_id, source_country, vote_type)
         DO UPDATE SET points = excluded.points, updated_at = excluded.updated_at`
      );
      for (const vote of snapshot.officialVotes) {
        stmt.run(vote.entryId, vote.sourceCountry, vote.voteType, vote.points, stamp);
      }
    }

    if (changed > 0 || snapshot.officialVotes?.length) {
      db.prepare("UPDATE rooms SET official_updated_at = ? WHERE room_code = ?").run(
        stamp,
        config.roomCode
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return changed;
}
