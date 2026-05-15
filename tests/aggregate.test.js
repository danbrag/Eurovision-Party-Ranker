import { describe, expect, it } from "vitest";
import { aggregateRankings, averageScores, finalEntries, submittedParticipantIds } from "../src/lib/aggregate.js";

const entries = [
  { id: "a", country: "Albania", isGrandFinalist: true, grandFinalOrder: 2 },
  { id: "b", country: "Belgium", isGrandFinalist: true, grandFinalOrder: 1 },
  { id: "c", country: "Croatia", isGrandFinalist: false, grandFinalOrder: null }
];

const people = [
  { id: "p1", displayName: "Dan" },
  { id: "p2", displayName: "Mom" }
];

describe("aggregate helpers", () => {
  it("falls back to all entries until the final lineup is complete", () => {
    expect(finalEntries(entries).map((entry) => entry.id)).toEqual(["b", "a", "c"]);
  });

  it("averages live scores", () => {
    const scores = [
      { participantId: "p1", entryId: "a", score: 12 },
      { participantId: "p2", entryId: "a", score: 8 },
      { participantId: "p1", entryId: "b", score: 4 }
    ];
    const result = averageScores(entries, people, scores);
    expect(result[0].id).toBe("a");
    expect(result[0].average).toBe(10);
    expect(result[0].complete).toBe(true);
  });

  it("aggregates rankings by lowest average rank", () => {
    const rankings = [
      { participantId: "p1", entryId: "a", rank: 1 },
      { participantId: "p2", entryId: "a", rank: 2 },
      { participantId: "p1", entryId: "b", rank: 2 },
      { participantId: "p2", entryId: "b", rank: 1 }
    ];
    const result = aggregateRankings(entries.slice(0, 2), people, rankings);
    expect(result.map((entry) => entry.averageRank)).toEqual([1.5, 1.5]);
  });

  it("marks participants submitted only when every required entry is ranked", () => {
    const rankings = [
      { participantId: "p1", entryId: "a", rank: 1 },
      { participantId: "p1", entryId: "b", rank: 2 },
      { participantId: "p2", entryId: "a", rank: 1 }
    ];
    const submitted = submittedParticipantIds(rankings, entries.slice(0, 2));
    expect(submitted.has("p1")).toBe(true);
    expect(submitted.has("p2")).toBe(false);
  });
});
