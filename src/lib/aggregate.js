export function finalEntries(entries) {
  const finalists = entries.filter((entry) => entry.isGrandFinalist);
  const hasRealFinal = finalists.length >= 20;
  const source = hasRealFinal ? finalists : entries;
  return orderEntries(source);
}

export function orderEntries(entries) {
  const hasFinalOrder = entries.some((entry) => Number.isFinite(entry.grandFinalOrder));
  return [...entries].sort((a, b) => {
    if (hasFinalOrder) {
      return (
        (a.grandFinalOrder ?? 999) - (b.grandFinalOrder ?? 999) ||
        a.country.localeCompare(b.country)
      );
    }
    return a.country.localeCompare(b.country);
  });
}

export function scoreMap(scores) {
  const map = new Map();
  for (const score of scores) {
    map.set(`${score.participantId}:${score.entryId}`, score.score);
  }
  return map;
}

export function rankingMap(rankings) {
  const map = new Map();
  for (const ranking of rankings) {
    map.set(`${ranking.participantId}:${ranking.entryId}`, ranking.rank);
  }
  return map;
}

export function averageScores(entries, participants, scores) {
  const byEntry = new Map(entries.map((entry) => [entry.id, []]));
  for (const score of scores) {
    if (!byEntry.has(score.entryId)) continue;
    byEntry.get(score.entryId).push(score.score);
  }
  return entries
    .map((entry) => {
      const values = byEntry.get(entry.id) || [];
      const average = values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
      return {
        ...entry,
        average,
        scoreCount: values.length,
        complete: values.length === participants.length
      };
    })
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.country.localeCompare(b.country));
}

export function aggregateRankings(entries, participants, rankings) {
  const participantCount = participants.length || 1;
  const byEntry = new Map(entries.map((entry) => [entry.id, []]));
  for (const ranking of rankings) {
    if (byEntry.has(ranking.entryId)) byEntry.get(ranking.entryId).push(ranking.rank);
  }
  return entries
    .map((entry) => {
      const ranks = byEntry.get(entry.id) || [];
      const averageRank = ranks.length
        ? ranks.reduce((sum, value) => sum + value, 0) / ranks.length
        : null;
      const spread = ranks.length > 1 ? Math.max(...ranks) - Math.min(...ranks) : 0;
      return {
        ...entry,
        ranks,
        averageRank,
        rankCount: ranks.length,
        complete: ranks.length === participantCount,
        spread
      };
    })
    .sort(
      (a, b) =>
        (a.averageRank ?? 999) - (b.averageRank ?? 999) ||
        (b.officialTotalPoints ?? -1) - (a.officialTotalPoints ?? -1) ||
        a.country.localeCompare(b.country)
    );
}

export function biggestDisagreements(entries, participants, scores) {
  const scoreByEntry = new Map(entries.map((entry) => [entry.id, []]));
  for (const score of scores) scoreByEntry.get(score.entryId)?.push(score.score);

  return entries
    .map((entry) => {
      const scoreValues = scoreByEntry.get(entry.id) || [];
      const scoreSpread =
        scoreValues.length > 1 ? Math.max(...scoreValues) - Math.min(...scoreValues) : 0;
      return { ...entry, scoreSpread, disagreement: scoreSpread };
    })
    .filter((entry) => entry.disagreement > 0)
    .sort((a, b) => b.disagreement - a.disagreement)
    .slice(0, 5);
}

export function submittedParticipantIds(rankings, entries) {
  const required = new Set(entries.map((entry) => entry.id));
  const byParticipant = new Map();
  for (const ranking of rankings) {
    if (!required.has(ranking.entryId)) continue;
    const set = byParticipant.get(ranking.participantId) || new Set();
    set.add(ranking.entryId);
    byParticipant.set(ranking.participantId, set);
  }
  return new Set(
    [...byParticipant.entries()]
      .filter(([, entryIds]) => entryIds.size === required.size)
      .map(([participantId]) => participantId)
  );
}
