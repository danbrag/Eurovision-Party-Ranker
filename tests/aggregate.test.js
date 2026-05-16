import { describe, expect, it } from "vitest";
import {
  aggregateRankings,
  averageScores,
  finalEntries,
  submittedParticipantIds,
  tastePredictionGaps
} from "../src/lib/aggregate.js";

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
      { participantId: "p1", entryId: "a", enjoymentScore: 12, predictionScore: 7 },
      { participantId: "p2", entryId: "a", enjoymentScore: 8, predictionScore: 9 },
      { participantId: "p1", entryId: "b", enjoymentScore: 4, predictionScore: 11 }
    ];
    const result = averageScores(entries, people, scores);
    expect(result[0].id).toBe("a");
    expect(result[0].average).toBe(10);
    expect(result[0].complete).toBe(true);

    const predictions = averageScores(entries, people, scores, "prediction");
    expect(predictions[0].id).toBe("b");
    expect(predictions[0].average).toBe(11);
    expect(predictions[0].complete).toBe(false);
  });

  it("finds the largest taste vs prediction gaps", () => {
    const scores = [
      { participantId: "p1", entryId: "a", enjoymentScore: 12, predictionScore: 3 },
      { participantId: "p2", entryId: "b", enjoymentScore: 5, predictionScore: 9 },
      { participantId: "p1", entryId: "c", enjoymentScore: 7 }
    ];
    const result = tastePredictionGaps(entries, people, scores);
    expect(result[0].entry.id).toBe("a");
    expect(result[0].participant.displayName).toBe("Dan");
    expect(result[0].gap).toBe(-9);
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
