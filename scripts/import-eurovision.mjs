import fs from "node:fs";
import path from "node:path";
import { fetchEurovisionDataset } from "../server/importers/eurovision.mjs";
import { openDatabase, upsertEntries } from "../server/db.mjs";

const outPath = path.join(process.cwd(), "server", "seed", "entries.json");

console.log("Fetching official Eurovision 2026 data...");
const entries = await fetchEurovisionDataset();
if (entries.length < 10) {
  throw new Error(`Importer only found ${entries.length} entries; refusing to overwrite seed.`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(entries, null, 2)}\n`);

const db = openDatabase();
upsertEntries(db, entries);
db.close();

console.log(`Imported ${entries.length} entries.`);
console.log(`Seed written to ${outPath}`);
