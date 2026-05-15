import * as cheerio from "cheerio";
import { EVENT } from "../config.mjs";

const COUNTRY_SLUGS = new Map([
  ["Czechia", "czechia"],
  ["United Kingdom", "united-kingdom"],
  ["San Marino", "san-marino"],
  ["Rest of the World", "rest-of-the-world"]
]);

const AUTOMATIC_FINALISTS_2026 = new Set([
  "austria",
  "france",
  "germany",
  "italy",
  "united-kingdom"
]);

const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();

const absoluteUrl = (value, base = "https://www.eurovision.com") => {
  if (!value) return null;
  return new URL(value, base).toString();
};

const toYouTubeWatchUrl = (value) => {
  if (!value) return null;
  const url = new URL(value, "https://www.youtube.com");
  if (url.hostname.includes("youtu.be")) {
    return `https://www.youtube.com/watch?v=${url.pathname.replace("/", "")}`;
  }
  const embed = url.pathname.match(/\/embed\/([^/?]+)/);
  if (embed) return `https://www.youtube.com/watch?v=${embed[1]}`;
  return url.toString().replace(/&amp;/g, "&");
};

const numberFrom = (value) => {
  const match = clean(value).match(/-?\d+/);
  return match ? Number(match[0]) : null;
};

const countryId = (country) =>
  (COUNTRY_SLUGS.get(country) || country)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function firstSentences(text, maxSentences = 2) {
  const normalized = clean(text);
  const pieces = normalized.match(/[^.!?]+[.!?]+/g);
  if (!pieces) return normalized.slice(0, 220);
  return pieces.slice(0, maxSentences).join(" ").slice(0, 280).trim();
}

function parseAge(text) {
  const age = text.match(/\b(\d{2})[- ]year[- ]old\b/i);
  if (age) return Number(age[1]);
  const born = text.match(/\bborn(?: on)? [A-Za-z]+\s+\d{1,2},?\s+(19\d{2}|20\d{2})\b/i);
  if (born) {
    const year = Number(born[1]);
    const ageIn2026 = 2026 - year;
    return ageIn2026 > 0 && ageIn2026 < 100 ? ageIn2026 : null;
  }
  return null;
}

export function parseParticipantCards(html, pageUrl = EVENT.officialAllParticipantsUrl) {
  const $ = cheerio.load(html);
  const entries = [];

  $(".card-participant").each((_, node) => {
    const card = $(node);
    const artist = clean(card.find("h3").first().text());
    const country = clean(card.find("[data-country-name]").last().text());
    const song = clean(
      card
        .find(".chip-text")
        .map((__, el) => clean($(el).text()))
        .get()
        .find((text) => text && text !== country)
    );
    if (!artist || !song || !country) return;

    const flagSrc = card.find('img[src*="/flags/flag_"]').last().attr("src") || "";
    const code = flagSrc.match(/flag_([a-z]{2})/i)?.[1]?.toUpperCase() || null;
    const detailUrl = absoluteUrl(card.find("a").first().attr("href"), pageUrl);
    const imageUrl =
      absoluteUrl(card.find(`img[alt="${artist}"]`).first().attr("src"), pageUrl) ||
      absoluteUrl(card.find(".participant-composition__halo img").first().attr("src"), pageUrl);

    entries.push({
      id: countryId(country),
      country,
      countryCode: code,
      artist,
      song,
      detailUrl,
      imageUrl,
      youtubeUrl: null,
      artistBio: null,
      artistAge: null,
      semifinal: null,
      semifinalOrder: null,
      isAutomaticFinalist: false,
      isGrandFinalist: false,
      grandFinalOrder: null,
      finalPlace: null,
      officialTotalPoints: null,
      officialJuryPoints: null,
      officialAudiencePoints: null,
      officialUpdatedAt: null
    });
  });

  return entries;
}

export function parseParticipantDetail(html, pageUrl) {
  const $ = cheerio.load(html);
  const youtubeUrl =
    toYouTubeWatchUrl($('iframe[src*="youtube.com/embed"]').first().attr("src")) ||
    toYouTubeWatchUrl($('a[href*="youtube.com/watch"], a[href*="youtu.be"]').first().attr("href"));
  const imageUrl =
    absoluteUrl($(".hero-bg-image").first().attr("src"), pageUrl) ||
    absoluteUrl($('meta[property="og:image"]').attr("content"), pageUrl);

  const bioRoot = $("h4")
    .filter((_, el) => clean($(el).text()).toLowerCase() === "biography")
    .first();
  const bioText = bioRoot
    .nextAll("section.rich-text")
    .first()
    .find("p")
    .map((_, el) => clean($(el).text()))
    .get()
    .join(" ");
  const fullText = clean($("body").text());
  const contestText = clean($(".editorial-sticky-aside").text());
  const semiMatch = contestText.match(/(First Semi-Final|Second Semi-Final|Grand Final)\s*-\s*(\d+|TBC)/i);

  return {
    youtubeUrl,
    imageUrl,
    artistBio: bioText ? firstSentences(bioText, 2) : null,
    artistAge: parseAge(bioText || fullText),
    semifinal: semiMatch?.[1]?.includes("First")
      ? "First Semi-Final"
      : semiMatch?.[1]?.includes("Second")
        ? "Second Semi-Final"
        : null,
    semifinalOrder: semiMatch?.[2] && semiMatch[2] !== "TBC" ? Number(semiMatch[2]) : null
  };
}

export function parseScoreboard(html) {
  const $ = cheerio.load(html);
  const entries = [];
  const officialVotes = [];

  $(".scoreboard-entry").each((_, node) => {
    const entry = $(node);
    const aria = entry.attr("aria-label") || "";
    const country =
      clean(entry.find("[data-country-name]").first().text()) ||
      clean(aria.replace(/^Scoreboard entry for\s+/i, ""));
    if (!country) return;

    const labels = {};
    entry.find(".data-row-entry-result-wrapper").each((__, wrapper) => {
      const label = clean($(wrapper).find(".data-row-entry-result-label").text()).toLowerCase();
      const value = clean(
        $(wrapper)
          .find("span")
          .last()
          .text()
      );
      if (label) labels[label] = value;
    });

    const chipTexts = entry
      .find(".chip-text")
      .map((__, el) => clean($(el).text()))
      .get();
    const totalFromChip = chipTexts.find((text) => /\d+\s+points?/i.test(text));
    const youtube = entry.find('a[href*="youtube.com"], a[href*="youtu.be"]').first();
    const song = clean(youtube.text());
    const artist = chipTexts.find(
      (text) =>
        text &&
        text !== song &&
        !/\d+\s+points?/i.test(text) &&
        !/winner|qualified|not qualified/i.test(text) &&
        text !== "-"
    );

    const rank = numberFrom(entry.find(".scoreboard-rank").first().text());
    entries.push({
      id: countryId(country),
      country,
      artist: artist || null,
      song: song || null,
      youtubeUrl: toYouTubeWatchUrl(youtube.attr("href")),
      finalPlace: rank,
      officialTotalPoints: numberFrom(totalFromChip),
      officialJuryPoints: numberFrom(labels.jury),
      officialAudiencePoints: numberFrom(labels.audience || labels.public),
      grandFinalOrder: numberFrom(labels["running order"])
    });
  });

  $(".country-details").each((_, detailNode) => {
    const detail = $(detailNode);
    const entryCountry = clean(detail.find("h2").first().text());
    if (!entryCountry) return;
    detail.find(".accordion--voting-results").each((__, accordionNode) => {
      const accordion = $(accordionNode);
      const label = clean(accordion.find(".accordion-label").first().text()).toLowerCase();
      const voteType = label.includes("jury")
        ? "jury"
        : label.includes("audience") || label.includes("public")
          ? "audience"
          : "total";
      accordion.find(".voting-data-row-entry").each((___, rowNode) => {
        const row = $(rowNode);
        const points = numberFrom(row.find(".voting-board-pill--darkbg").first().text());
        if (!points) return;
        row.find("[data-country-name]").each((____, countryNode) => {
          const sourceCountry = clean($(countryNode).text());
          if (!sourceCountry) return;
          officialVotes.push({
            entryId: countryId(entryCountry),
            sourceCountry,
            voteType,
            points
          });
        });
      });
    });
  });

  return { entries, officialVotes };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Eurovision watch-party app data importer (personal use)"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await iteratee(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchOfficialSnapshot(url = EVENT.officialGrandFinalUrl) {
  const html = await fetchText(url);
  return parseScoreboard(html);
}

export async function fetchEurovisionDataset() {
  const participantsHtml = await fetchText(EVENT.officialAllParticipantsUrl);
  const entries = parseParticipantCards(participantsHtml);
  const detailResults = await mapLimit(entries, 4, async (entry) => {
    if (!entry.detailUrl) return {};
    try {
      return parseParticipantDetail(await fetchText(entry.detailUrl), entry.detailUrl);
    } catch (error) {
      console.warn(`Could not fetch detail for ${entry.country}: ${error.message}`);
      return {};
    }
  });

  const byId = new Map(
    entries.map((entry, index) => [
      entry.id,
      {
        ...entry,
        ...detailResults[index],
        youtubeUrl: detailResults[index]?.youtubeUrl || entry.youtubeUrl,
        imageUrl: detailResults[index]?.imageUrl || entry.imageUrl
      }
    ])
  );

  const [firstSemi, secondSemi, finalSnapshot] = await Promise.allSettled([
    fetchOfficialSnapshot(EVENT.firstSemiUrl),
    fetchOfficialSnapshot(EVENT.secondSemiUrl),
    fetchOfficialSnapshot(EVENT.officialGrandFinalUrl)
  ]);

  const applySemi = (result, label) => {
    if (result.status !== "fulfilled") return;
    for (const item of result.value.entries) {
      const existing = byId.get(item.id);
      if (!existing) continue;
      existing.semifinal = label;
      existing.semifinalOrder = item.grandFinalOrder || existing.semifinalOrder;
    }
  };
  applySemi(firstSemi, "First Semi-Final");
  applySemi(secondSemi, "Second Semi-Final");

  if (finalSnapshot.status === "fulfilled") {
    const finalCountries = new Set(finalSnapshot.value.entries.map((entry) => entry.id));
    for (const item of finalSnapshot.value.entries) {
      const existing = byId.get(item.id);
      if (!existing) continue;
      existing.isGrandFinalist = true;
      existing.isAutomaticFinalist = AUTOMATIC_FINALISTS_2026.has(item.id);
      existing.grandFinalOrder = item.grandFinalOrder || existing.grandFinalOrder;
      existing.finalPlace = item.finalPlace || existing.finalPlace;
      existing.officialTotalPoints =
        item.officialTotalPoints ?? existing.officialTotalPoints;
      existing.officialJuryPoints = item.officialJuryPoints ?? existing.officialJuryPoints;
      existing.officialAudiencePoints =
        item.officialAudiencePoints ?? existing.officialAudiencePoints;
      existing.youtubeUrl = item.youtubeUrl || existing.youtubeUrl;
    }
    for (const entry of byId.values()) {
      entry.isGrandFinalist = finalCountries.has(entry.id);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.country.localeCompare(b.country));
}
