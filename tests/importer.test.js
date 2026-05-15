import { describe, expect, it } from "vitest";
import { parseParticipantCards, parseScoreboard } from "../server/importers/eurovision.mjs";

describe("Eurovision importer parsers", () => {
  it("parses participant cards from official-style markup", () => {
    const html = `
      <div class="card-participant">
        <a href="/eurovision-song-contest/vienna-2026/all-participants/alis/">
          <h3>Alis</h3>
          <p class="chip-text">Nan</p>
          <img src="/static/images/flags/flag_al.svg">
          <p data-country-name>Albania</p>
        </a>
      </div>`;
    const entries = parseParticipantCards(html);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "albania",
      country: "Albania",
      countryCode: "AL",
      artist: "Alis",
      song: "Nan"
    });
  });

  it("parses official scoreboard totals", () => {
    const html = `
      <div class="scoreboard-entry" aria-label="Scoreboard entry for Austria">
        <div class="scoreboard-rank">1</div>
        <p class="chip-text">436 points</p>
        <p data-country-name>Austria</p>
        <p class="chip-text">JJ</p>
        <a href="https://www.youtube.com/watch?v=onOex2WXjbA"><p class="chip-text">Wasted Love</p></a>
        <div class="data-row-entry-result-wrapper"><span class="data-row-entry-result-label">Jury</span><span>258</span></div>
        <div class="data-row-entry-result-wrapper"><span class="data-row-entry-result-label">Audience</span><span>178</span></div>
        <div class="data-row-entry-result-wrapper"><span class="data-row-entry-result-label">Running Order</span><span>9</span></div>
      </div>`;
    const result = parseScoreboard(html);
    expect(result.entries[0]).toMatchObject({
      id: "austria",
      finalPlace: 1,
      officialTotalPoints: 436,
      officialJuryPoints: 258,
      officialAudiencePoints: 178,
      grandFinalOrder: 9
    });
  });
});
