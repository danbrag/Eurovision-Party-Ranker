import { EVENT, config } from "./config.mjs";
import { applyOfficialSnapshot, getState } from "./db.mjs";
import { fetchOfficialSnapshot } from "./importers/eurovision.mjs";

export class OfficialWatcher {
  #timer = null;
  #running = false;

  constructor(db, broadcast) {
    this.db = db;
    this.broadcast = broadcast;
  }

  get running() {
    return this.#running;
  }

  async pullOnce() {
    const snapshot = await fetchOfficialSnapshot(EVENT.officialGrandFinalUrl);
    const changed = applyOfficialSnapshot(this.db, snapshot);
    if (changed > 0 || snapshot.officialVotes?.length) {
      this.broadcast(getState(this.db, config.roomCode));
    }
    return {
      changed,
      officialVotes: snapshot.officialVotes?.length || 0,
      entriesSeen: snapshot.entries?.length || 0
    };
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    const tick = async () => {
      try {
        await this.pullOnce();
      } catch (error) {
        console.warn(`Official watcher pull failed: ${error.message}`);
      }
      if (this.#running) {
        this.#timer = setTimeout(tick, config.watcherIntervalMs);
      }
    };
    this.#timer = setTimeout(tick, 100);
  }

  stop() {
    this.#running = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
