import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import confetti from "canvas-confetti";
import {
  Award,
  BarChart3,
  Calculator,
  ChevronDown,
  ChevronRight,
  Crown,
  Eye,
  Lock,
  Music2,
  PartyPopper,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Star,
  Trophy,
  UserPlus,
  Users
} from "lucide-react";
import { api, browserToken } from "./api.js";
import {
  averageScores,
  biggestDisagreements,
  finalEntries,
  scoreMap
} from "./lib/aggregate.js";

const tabs = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "score", label: "My Rankings", icon: Star },
  { id: "results", label: "Results", icon: Trophy },
  { id: "admin", label: "Admin", icon: Settings }
];

const emptyState = {
  room: null,
  entries: [],
  participants: [],
  scores: [],
  rankings: [],
  officialVotes: []
};

const SESSION_KEY = "eurovision-session";
const PROFILES_KEY = "eurovision-profiles";
const ACTIVE_PROFILE_KEY = "eurovision-active-profile-id";
const DEFAULT_MAX_PARTICIPANTS = 6;

function readJsonStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function uniqueProfiles(profiles) {
  const byId = new Map();
  for (const profile of profiles || []) {
    if (!profile?.id || !profile?.displayName || !profile?.roomCode) continue;
    byId.set(profile.id, profile);
  }
  return [...byId.values()];
}

function loadProfileState() {
  const savedProfiles = readJsonStorage(PROFILES_KEY, []);
  const profiles = uniqueProfiles([
    ...(Array.isArray(savedProfiles) ? savedProfiles : []),
    readJsonStorage(SESSION_KEY, null)
  ]);
  const activeId = localStorage.getItem(ACTIVE_PROFILE_KEY);
  const active = profiles.find((profile) => profile.id === activeId) || profiles.at(-1) || null;
  return { profiles, active };
}

function saveProfileState(profiles, active) {
  const nextProfiles = uniqueProfiles(profiles);
  localStorage.setItem(PROFILES_KEY, JSON.stringify(nextProfiles));
  if (active) {
    localStorage.setItem(ACTIVE_PROFILE_KEY, active.id);
    localStorage.setItem(SESSION_KEY, JSON.stringify(active));
  } else {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
    localStorage.removeItem(SESSION_KEY);
  }
}

function upsertProfile(profiles, profile) {
  return uniqueProfiles([...profiles.filter((item) => item.id !== profile.id), profile]);
}

function formatEntry(entry) {
  return `${entry.country} - ${entry.song} - ${entry.artist}`;
}

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function countryCodeBadge(code) {
  return code || "ESC";
}

function orderBadge(entry) {
  if (Number.isFinite(entry.grandFinalOrder)) return entry.grandFinalOrder;
  if (Number.isFinite(entry.semifinalOrder)) return entry.semifinalOrder;
  return countryCodeBadge(entry.countryCode);
}

function formatScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  const fixed = number.toFixed(2);
  if (fixed.endsWith(".00")) return String(Math.round(number));
  return fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
}

function rankEntriesByScore(entries, getScore) {
  return new Map(
    entries
      .map((entry) => ({ entry, score: getScore(entry) }))
      .filter(({ score }) => score != null && Number.isFinite(Number(score)))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.entry.grandFinalOrder ?? 999) - (b.entry.grandFinalOrder ?? 999) ||
          a.entry.country.localeCompare(b.entry.country)
      )
      .map(({ entry }, index) => [entry.id, index + 1])
  );
}

function rankDelta(rank, officialRank) {
  if (!Number.isFinite(rank) || !Number.isFinite(officialRank)) return null;
  return rank - officialRank;
}

function youtubeEmbedUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    const id = parsed.searchParams.get("v") || parsed.pathname.split("/embed/")[1]?.split("/")[0];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  } catch {
    return null;
  }
}

function participantScoredEveryEntry(participantId, entries, scores) {
  if (!participantId || entries.length === 0) return false;
  const scored = new Set(
    scores
      .filter((score) => score.participantId === participantId)
      .map((score) => score.entryId)
  );
  return entries.every((entry) => scored.has(entry.id));
}

function useSocket(setState) {
  useEffect(() => {
    const socket = io();
    socket.on("state:update", setState);
    return () => socket.close();
  }, [setState]);
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [state, setState] = useState(emptyState);
  const [profileState, setProfileState] = useState(loadProfileState);
  const [activeTab, setActiveTab] = useState("preview");
  const [resultsGate, setResultsGate] = useState({ open: false, returnTab: "preview" });
  const [error, setError] = useState("");
  const [celebrated, setCelebrated] = useState(false);
  const participant = profileState.active;
  const localProfiles = profileState.profiles;

  useSocket(setState);

  useEffect(() => {
    Promise.all([api("/api/config"), api("/api/state")])
      .then(([appConfig, appState]) => {
        setConfig(appConfig);
        setState(appState);
      })
      .catch((err) => setError(err.message));
  }, []);

  const entries = state.entries || [];
  const performanceEntries = useMemo(() => finalEntries(entries), [entries]);
  const previewEntries = performanceEntries;
  const ownScores = useMemo(() => scoreMap(state.scores || []), [state.scores]);
  const maxParticipants = config?.maxParticipants || DEFAULT_MAX_PARTICIPANTS;
  const allScored =
    state.participants.length > 0 &&
    state.participants.every((person) =>
      participantScoredEveryEntry(person.id, performanceEntries, state.scores || [])
    );

  useEffect(() => {
    if (!participant || !state.room) return;
    const roomCode = state.room.roomCode;
    const participantIds = new Set((state.participants || []).map((person) => person.id));
    const validProfiles = localProfiles.filter(
      (profile) => profile.roomCode === roomCode && participantIds.has(profile.id)
    );
    const active = validProfiles.find((profile) => profile.id === participant.id) || null;
    if (validProfiles.length === localProfiles.length && active?.id === participant.id) return;

    saveProfileState(validProfiles, active);
    setProfileState({ profiles: validProfiles, active });
    if (!active) {
      setActiveTab("preview");
      setResultsGate({ open: false, returnTab: "preview" });
      if (participant) setError("The room was reset. Please join again.");
    }
  }, [participant, state.room, state.participants, localProfiles]);

  useEffect(() => {
    if (allScored && !celebrated) {
      setCelebrated(true);
      confetti({ particleCount: 160, spread: 80, origin: { y: 0.65 } });
    }
  }, [allScored, celebrated]);

  async function joinRoom(form) {
    setError("");
    try {
      const data = await api("/api/join", {
        method: "POST",
        body: { ...form, browserToken: browserToken() }
      });
      const next = { ...data.participant, roomCode: form.roomCode.toUpperCase() };
      const nextProfiles = upsertProfile(localProfiles, next);
      saveProfileState(nextProfiles, next);
      setProfileState({ profiles: nextProfiles, active: next });
      setState(data.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateScore(entryId, score) {
    if (!participant) return;
    setError("");
    try {
      const data = await api("/api/score", {
        method: "POST",
        body: {
          roomCode: participant.roomCode,
          participantId: participant.id,
          browserToken: browserToken(),
          entryId,
          score
        }
      });
      setState(data.state);
    } catch (err) {
      setError(err.message);
    }
  }

  function resetSession() {
    saveProfileState(localProfiles, null);
    setProfileState((current) => ({ ...current, active: null }));
    setActiveTab("preview");
    setResultsGate({ open: false, returnTab: "preview" });
  }

  function switchProfile(profileId) {
    const next = localProfiles.find((profile) => profile.id === profileId);
    if (!next) return;
    saveProfileState(localProfiles, next);
    setProfileState({ profiles: localProfiles, active: next });
    setError("");
  }

  function forgetProfile(profileId) {
    const nextProfiles = localProfiles.filter((profile) => profile.id !== profileId);
    const nextActive = participant?.id === profileId ? null : participant;
    saveProfileState(nextProfiles, nextActive);
    setProfileState({ profiles: nextProfiles, active: nextActive });
  }

  function selectTab(tabId) {
    if (tabId === "results") {
      setResultsGate({ open: true, returnTab: activeTab === "results" ? "score" : activeTab });
      setActiveTab("results");
      return;
    }
    setResultsGate({ open: false, returnTab: tabId });
    setActiveTab(tabId);
  }

  if (!config || !state.room) {
    return <Splash message={error || "Warming up the stage lights..."} />;
  }

  if (!participant) {
    return (
      <JoinScreen
        config={config}
        error={error}
        onJoin={joinRoom}
        participantCount={state.participants.length}
        maxParticipants={maxParticipants}
        localProfiles={localProfiles}
        onSwitchProfile={switchProfile}
        onForgetProfile={forgetProfile}
      />
    );
  }

  return (
    <div className={cx("app-shell", resultsGate.open && "results-locked")}>
      <StageBackdrop />
      <header className="topbar">
        <div>
          <p className="eyebrow">Eurovision 2026 watch party</p>
          <h1>Eurovision Finale Night</h1>
          <p className="subtle">
            Grand Final: May 16, 2026, 3:00 PM ET. Room {state.room.roomCode}.
          </p>
        </div>
        <div className="identity-pill">
          <Users size={18} />
          <div className="profile-switcher" aria-label="Active voter profile">
            {localProfiles
              .filter((profile) => profile.roomCode === participant.roomCode)
              .map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className={cx(profile.id === participant.id && "active")}
                  aria-pressed={profile.id === participant.id}
                  onClick={() => switchProfile(profile.id)}
                >
                  {profile.displayName}
                </button>
              ))}
          </div>
          <button type="button" onClick={resetSession}>
            <UserPlus size={16} />
            <span>Add voter</span>
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <nav className="tabbar" aria-label="Main views">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={cx(activeTab === tab.id && "active")}
              onClick={() => selectTab(tab.id)}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <main>
        {activeTab === "preview" && <PreviewView entries={previewEntries} />}
        {activeTab === "score" && (
          <ScoreView
            entries={performanceEntries}
            participant={participant}
            scoreLookup={ownScores}
            onScore={updateScore}
          />
        )}
        {activeTab === "results" && (
          resultsGate.open ? (
            <ResultsGate
              onConfirm={() => setResultsGate((current) => ({ ...current, open: false }))}
              onCancel={() => {
                setActiveTab(resultsGate.returnTab || "score");
                setResultsGate({ open: false, returnTab: resultsGate.returnTab || "score" });
              }}
            />
          ) : (
            <ResultsView
              entries={performanceEntries}
              participants={state.participants}
              scores={state.scores}
              officialVotes={state.officialVotes}
              allScored={allScored}
            />
          )
        )}
        {activeTab === "admin" && (
          <AdminView
            entries={performanceEntries}
            state={state}
            setState={setState}
            setConfig={setConfig}
            setError={setError}
            config={config}
          />
        )}
      </main>
    </div>
  );
}

function Splash({ message }) {
  return (
    <div className="splash">
      <StageBackdrop />
      <div className="splash-card">
        <Sparkles size={32} />
        <p>{message}</p>
      </div>
    </div>
  );
}

function StageBackdrop() {
  return (
    <div className="stage-backdrop" aria-hidden="true">
      <div className="beam beam-one" />
      <div className="beam beam-two" />
      <div className="beam beam-three" />
      <div className="light-grid" />
    </div>
  );
}

function JoinScreen({
  config,
  error,
  onJoin,
  participantCount,
  maxParticipants,
  localProfiles,
  onSwitchProfile,
  onForgetProfile
}) {
  const [roomCode, setRoomCode] = useState(config.roomCode);
  const [displayName, setDisplayName] = useState("");
  const [releasing, setReleasing] = useState(false);
  const roomProfiles = localProfiles.filter((profile) => profile.roomCode === roomCode.toUpperCase());

  async function releaseName() {
    if (!displayName.trim()) return;
    setReleasing(true);
    try {
      await api("/api/release-name", {
        method: "POST",
        body: { roomCode, displayName }
      });
      const releasedProfile = roomProfiles.find(
        (profile) => profile.displayName.toLowerCase() === displayName.trim().toLowerCase()
      );
      if (releasedProfile) onForgetProfile(releasedProfile.id);
      window.location.reload();
    } catch {
      setReleasing(false);
    }
  }

  return (
    <div className="join-page">
      <StageBackdrop />
      <section className="join-panel">
        <p className="eyebrow">Private watch-party room</p>
        <h1>Eurovision Finale Night</h1>
        <p>
          Join from your phone, preview the songs, score live, and reveal the
          family scoreboard when everyone has scored the final.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onJoin({ roomCode, displayName });
          }}
        >
          <label>
            Room code
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
          </label>
          <label>
            Your name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Mom, Beth, Dan"
            />
          </label>
          {error && <div className="error-banner compact">{error}</div>}
          {error?.includes("already claimed") && (
            <button className="secondary-action" type="button" onClick={releaseName} disabled={releasing}>
              Release this local name
            </button>
          )}
          <button className="primary-action" type="submit">
            <Lock size={18} />
            Enter room
          </button>
        </form>
        {!!roomProfiles.length && (
          <div className="local-profiles">
            <p className="eyebrow">Local profiles</p>
            <div>
              {roomProfiles.map((profile) => (
                <button key={profile.id} type="button" onClick={() => onSwitchProfile(profile.id)}>
                  {profile.displayName}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="subtle">{participantCount}/{maxParticipants} people have joined.</p>
      </section>
    </div>
  );
}

function PreviewView({ entries }) {
  const hasFinalOrder = entries.some((entry) => entry.grandFinalOrder);
  return (
    <section className="view-stack">
      <ViewHeader
        icon={Music2}
        title="Song Preview"
        description={
          hasFinalOrder
            ? "Sorted by the current official Grand Final order."
            : "No final running order yet, so this is alphabetical by country."
        }
      />
      <div className="song-list">
        {entries.map((entry) => (
          <SongPreviewRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function ScoreView({ entries, participant, scoreLookup, onScore }) {
  const [draftScores, setDraftScores] = useState({});
  const pendingScores = useRef(new Map());
  const rankedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const aScore = scoreLookup.get(`${participant.id}:${a.id}`);
        const bScore = scoreLookup.get(`${participant.id}:${b.id}`);
        if (aScore == null && bScore == null) {
          return (a.grandFinalOrder ?? 999) - (b.grandFinalOrder ?? 999) || a.country.localeCompare(b.country);
        }
        if (aScore == null) return 1;
        if (bScore == null) return -1;
        return (
          bScore - aScore ||
          (a.grandFinalOrder ?? 999) - (b.grandFinalOrder ?? 999) ||
          a.country.localeCompare(b.country)
        );
      }),
    [entries, participant.id, scoreLookup]
  );

  useEffect(() => {
    setDraftScores((current) => {
      const next = { ...current };
      let changed = false;
      for (const [entryId, value] of Object.entries(current)) {
        const saved = scoreLookup.get(`${participant.id}:${entryId}`) ?? 0;
        if (saved === value) {
          delete next[entryId];
          pendingScores.current.delete(entryId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [participant.id, scoreLookup]);

  function draftScore(entryId, value) {
    setDraftScores((current) => ({ ...current, [entryId]: value }));
  }

  function commitScore(entryId, value) {
    const saved = scoreLookup.get(`${participant.id}:${entryId}`) ?? 0;
    if (saved === value || pendingScores.current.get(entryId) === value) return;
    pendingScores.current.set(entryId, value);
    Promise.resolve(onScore(entryId, value)).finally(() => {
      if (pendingScores.current.get(entryId) === value) pendingScores.current.delete(entryId);
    });
  }

  return (
    <section className="view-stack">
      <ViewHeader
        icon={Star}
        title="My Rankings"
        description="Score in performance order on the left; your ranking board updates from those scores on the right."
      />
      <div className="ranking-workspace">
        <section className="ranking-input-panel" aria-label="Performance-order scoring">
          <h3>Score In Performance Order</h3>
          <div className="score-list">
            {entries.map((entry) => {
              const savedScore = scoreLookup.get(`${participant.id}:${entry.id}`) ?? 0;
              const score = draftScores[entry.id] ?? savedScore;
              return (
                <article key={entry.id} className="score-row score-input-row">
                  <span className="performance-order">{orderBadge(entry)}</span>
                  <div className="score-thumb">
                    {entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" /> : <div className="image-fallback" />}
                  </div>
                  <SongMini entry={entry} badge={null} />
                  <div className="score-controls">
                    <output>{formatScore(score)}</output>
                    <input
                      type="range"
                      min="0"
                      max="12"
                      step="0.25"
                      value={score}
                      onChange={(event) => draftScore(entry.id, Number(event.target.value))}
                      onPointerUp={(event) => commitScore(entry.id, Number(event.currentTarget.value))}
                      onKeyUp={(event) => commitScore(entry.id, Number(event.currentTarget.value))}
                      onBlur={(event) => commitScore(entry.id, Number(event.currentTarget.value))}
                      aria-label={`Score ${formatEntry(entry)}`}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <section className="ranking-board-panel" aria-label="Score-derived ranking board">
          <h3>Your Ranking Board</h3>
          <RankingBoardList entries={rankedEntries} participantId={participant.id} scoreLookup={scoreLookup} />
        </section>
      </div>
    </section>
  );
}

function RankingBoardList({ entries, participantId, scoreLookup }) {
  const listRef = useRef(null);
  const positions = useRef(new Map());
  const animationCleanups = useRef(new WeakMap());
  const orderKey = entries.map((entry) => entry.id).join("|");

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nextPositions = new Map();
    for (const row of list.querySelectorAll("[data-rank-id]")) {
      const id = row.getAttribute("data-rank-id");
      const rect = row.getBoundingClientRect();
      const previous = positions.current.get(id);
      if (previous) {
        const deltaY = previous.top - rect.top;
        if (Math.abs(deltaY) > 1) {
          const previousCleanup = animationCleanups.current.get(row);
          if (previousCleanup) previousCleanup();

          row.style.transition = "none";
          row.style.transform = `translate3d(0, ${deltaY}px, 0)`;
          row.style.opacity = "0.96";
          row.style.zIndex = "2";
          row.getBoundingClientRect();

          let frame = 0;
          const cleanup = () => {
            if (frame) cancelAnimationFrame(frame);
            row.style.transition = "";
            row.style.transform = "";
            row.style.opacity = "";
            row.style.zIndex = "";
            row.removeEventListener("transitionend", onTransitionEnd);
            animationCleanups.current.delete(row);
          };
          const onTransitionEnd = (event) => {
            if (event.propertyName === "transform") cleanup();
          };
          animationCleanups.current.set(row, cleanup);
          row.addEventListener("transitionend", onTransitionEnd);

          frame = requestAnimationFrame(() => {
            row.style.transition =
              "transform 1200ms cubic-bezier(0.19, 1, 0.22, 1), opacity 650ms ease";
            row.style.transform = "translate3d(0, 0, 0)";
            row.style.opacity = "1";
          });
        }
      }
      nextPositions.set(id, { top: rect.top });
    }
    positions.current = nextPositions;
  }, [orderKey]);

  return (
    <div ref={listRef} className="ranking-board-list">
      {entries.map((entry, index) => (
        <RankingBoardRow
          key={entry.id}
          entry={entry}
          rank={index + 1}
          score={scoreLookup.get(`${participantId}:${entry.id}`)}
        />
      ))}
    </div>
  );
}

function RankingBoardRow({ entry, rank, score }) {
  return (
    <article className="ranking-board-row" data-rank-id={entry.id}>
      <span className="personal-rank">#{rank}</span>
      <div>
        <strong>{entry.country}</strong>
        <span>{entry.song} by {entry.artist}</span>
      </div>
      <output>{score == null ? "--" : formatScore(score)}</output>
    </article>
  );
}

function ResultsGate({ onConfirm, onCancel }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, onConfirm]);

  return (
    <section className="results-gate" aria-label="Results confirmation">
      <div className="results-modal" role="dialog" aria-modal="true" aria-labelledby="results-title">
        <Trophy size={34} />
        <h2 id="results-title">Are you sure you want to see results?</h2>
        <p>
          This reveals the shared scoreboard, average rankings, disagreements, and official result panels.
        </p>
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Not yet
          </button>
          <button ref={confirmRef} className="primary-action" type="button" onClick={onConfirm}>
            Show results
          </button>
        </div>
      </div>
    </section>
  );
}

function buildResultsAnalysis(entries, participants, scores, averages) {
  const lookup = scoreMap(scores);
  const averageLookup = new Map(averages.map((entry) => [entry.id, entry.average]));
  const groupRanks = rankEntriesByScore(entries, (entry) => averageLookup.get(entry.id));
  const participantRanks = new Map(
    participants.map((person) => [
      person.id,
      rankEntriesByScore(entries, (entry) => lookup.get(`${person.id}:${entry.id}`))
    ])
  );

  const officialRows = entries
    .filter((entry) => Number.isFinite(entry.finalPlace))
    .sort((a, b) => a.finalPlace - b.finalPlace)
    .map((entry) => {
      const groupRank = groupRanks.get(entry.id);
      return {
        entry,
        officialRank: entry.finalPlace,
        officialPoints: entry.officialTotalPoints,
        groupAverage: averageLookup.get(entry.id),
        groupRank,
        groupDelta: rankDelta(groupRank, entry.finalPlace),
        participantRanks: participants.map((person) => {
          const rank = participantRanks.get(person.id)?.get(entry.id);
          return {
            person,
            rank,
            delta: rankDelta(rank, entry.finalPlace)
          };
        })
      };
    });

  const closestRankers = participants
    .map((person) => {
      const rows = officialRows
        .map((row) => row.participantRanks.find((item) => item.person.id === person.id))
        .filter((item) => Number.isFinite(item?.rank));
      const totalMiss = rows.reduce((sum, item) => sum + Math.abs(item.delta), 0);
      const exactMatches = rows.filter((item) => item.delta === 0).length;
      return {
        person,
        compared: rows.length,
        exactMatches,
        totalMiss,
        averageMiss: rows.length ? totalMiss / rows.length : null
      };
    })
    .filter((item) => item.compared > 0)
    .sort(
      (a, b) =>
        a.averageMiss - b.averageMiss ||
        a.totalMiss - b.totalMiss ||
        b.exactMatches - a.exactMatches ||
        a.person.displayName.localeCompare(b.person.displayName)
    );

  const groupGaps = officialRows
    .filter((row) => Number.isFinite(row.groupDelta) && row.groupDelta !== 0)
    .sort((a, b) => Math.abs(b.groupDelta) - Math.abs(a.groupDelta))
    .slice(0, 5);

  const consensus = entries
    .map((entry) => {
      const values = scores
        .filter((score) => score.entryId === entry.id)
        .map((score) => score.score);
      const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : null;
      return {
        entry,
        spread,
        count: values.length,
        average: averageLookup.get(entry.id)
      };
    })
    .filter((item) => item.spread != null)
    .sort((a, b) => a.spread - b.spread || (b.average ?? -1) - (a.average ?? -1))
    .slice(0, 5);

  return { officialRows, closestRankers, groupGaps, consensus };
}

function ResultsView({ entries, participants, scores, officialVotes, allScored }) {
  const [sort, setSort] = useState({ key: "order", direction: "asc" });
  const averages = averageScores(entries, participants, scores);
  const disagreements = biggestDisagreements(entries, participants, scores);
  const analysis = useMemo(
    () => buildResultsAnalysis(entries, participants, scores, averages),
    [entries, participants, scores, averages]
  );

  return (
    <section className="view-stack">
      <ViewHeader
        icon={Trophy}
        title="Scoreboards"
        description={allScored ? "Everyone scored every finalist. Crown the Group winner." : "Live group scores update here as everyone votes."}
      />
      {allScored && (
        <div className="celebration-banner">
          <PartyPopper size={20} />
          Everyone scored every finalist.
        </div>
      )}
      <ResultsWinnerCard standings={analysis.closestRankers} officialCount={analysis.officialRows.length} />
      <ResultScoreTable
        entries={entries}
        participants={participants}
        scores={scores}
        averages={averages}
        sort={sort}
        setSort={setSort}
      />
      <OfficialResultsTable rows={analysis.officialRows} participants={participants} officialVotes={officialVotes} />
      <ResultsInsights
        disagreements={disagreements}
        closestRankers={analysis.closestRankers}
        groupGaps={analysis.groupGaps}
        consensus={analysis.consensus}
      />
    </section>
  );
}

function ResultsWinnerCard({ standings, officialCount }) {
  const winner = standings[0];
  const tiedWinners = winner
    ? standings.filter(
        (item) =>
          item.averageMiss === winner.averageMiss &&
          item.totalMiss === winner.totalMiss &&
          item.compared === winner.compared
      )
    : [];
  const isTie = tiedWinners.length > 1;
  const winnerNames = tiedWinners.map((item) => item.person.displayName).join(", ");

  return (
    <section className="winner-card">
      <div className="winner-card-main">
        <div className="winner-icon"><Trophy size={24} /></div>
        <div>
          <p className="eyebrow">Group Winner</p>
          <h3>{winner ? (isTie ? `Tie: ${winnerNames}` : winner.person.displayName) : "Waiting for official results"}</h3>
          <p>
            {winner
              ? `Closest to the official final order, averaging ${formatScore(winner.averageMiss)} places off across ${winner.compared} ${winner.compared === 1 ? "song" : "songs"}.`
              : "Add official placements and scores to crown the closest ranker."}
          </p>
        </div>
      </div>
      <div className="winner-standings">
        {standings.length ? (
          standings.slice(0, 3).map((item, index) => (
            <article key={item.person.id} className={cx("winner-standing", index === 0 && "first")}>
              <span>{index + 1}</span>
              <strong>{item.person.displayName}</strong>
              <output>{item.totalMiss} off</output>
              <small>{item.exactMatches}/{item.compared || officialCount} exact</small>
            </article>
          ))
        ) : (
          <p className="empty-copy">No standings yet.</p>
        )}
      </div>
    </section>
  );
}

function ResultScoreTable({ entries, participants, scores, averages, sort, setSort }) {
  const [collapsed, setCollapsed] = useState(false);
  const scoreLookup = scoreMap(scores);
  const averageLookup = new Map(averages.map((entry) => [entry.id, entry.average]));

  function sortValue(entry, key) {
    if (key === "order") return entry.grandFinalOrder ?? 999;
    if (key === "country") return entry.country.toLowerCase();
    if (key === "artist") return entry.artist.toLowerCase();
    if (key === "song") return entry.song.toLowerCase();
    if (key === "average") return averageLookup.get(entry.id) ?? -1;
    if (key.startsWith("participant:")) {
      const participantId = key.replace("participant:", "");
      return scoreLookup.get(`${participantId}:${entry.id}`) ?? -1;
    }
    return "";
  }

  const sortedEntries = [...entries].sort((a, b) => {
    const aValue = sortValue(a, sort.key);
    const bValue = sortValue(b, sort.key);
    const direction = sort.direction === "asc" ? 1 : -1;
    if (typeof aValue === "string" || typeof bValue === "string") {
      return direction * String(aValue).localeCompare(String(bValue));
    }
    return direction * (aValue - bValue || (a.grandFinalOrder ?? 999) - (b.grandFinalOrder ?? 999));
  });

  function changeSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  function sortLabel(key) {
    if (sort.key !== key) return "";
    return sort.direction === "asc" ? " ↑" : " ↓";
  }

  return (
    <section className="score-matrix">
      <div className="score-matrix-header">
        <div>
          <h3>User Score Table</h3>
          <p>Scores are out of 12. Default is performance order.</p>
        </div>
        <button
          className="collapse-button"
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          <span>{collapsed ? "Show" : "Hide"}</span>
        </button>
      </div>
      {!collapsed && <div className="score-table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <button type="button" onClick={() => changeSort("order")}>Run{sortLabel("order")}</button>
              </th>
              <th>
                <button type="button" onClick={() => changeSort("country")}>Country{sortLabel("country")}</button>
              </th>
              <th>
                <button type="button" onClick={() => changeSort("artist")}>Artist{sortLabel("artist")}</button>
              </th>
              <th>
                <button type="button" onClick={() => changeSort("song")}>Song Title{sortLabel("song")}</button>
              </th>
              <th>
                <button type="button" onClick={() => changeSort("average")}>Avg{sortLabel("average")}</button>
              </th>
              {participants.map((person) => {
                const key = `participant:${person.id}`;
                return (
                  <th key={person.id}>
                    <button type="button" onClick={() => changeSort(key)}>
                      {person.displayName}{sortLabel(key)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr key={entry.id}>
                <td>{orderBadge(entry)}</td>
                <td>{entry.country}</td>
                <td>{entry.artist}</td>
                <td>{entry.song}</td>
                <td>{averageLookup.get(entry.id) == null ? "--" : formatScore(averageLookup.get(entry.id))}</td>
                {participants.map((person) => {
                  const score = scoreLookup.get(`${person.id}:${entry.id}`);
                  return <td key={person.id}>{score == null ? "--" : formatScore(score)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function OfficialResultsTable({ rows, participants, officialVotes }) {
  return (
    <section className="official-comparison">
      <div className="score-matrix-header">
        <div>
          <h3>Official Eurovision Results</h3>
          <p>Group avg is the average Group score out of 12. Group rank and player ranks compare score-derived rankings against the official place.</p>
        </div>
        {!!officialVotes.length && (
          <span className="table-note">{officialVotes.length} country-by-country vote rows imported.</span>
        )}
      </div>
      {rows.length ? (
        <div className="score-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Result</th>
                <th>Country</th>
                <th>Song</th>
                <th>Total</th>
                <th>Jury</th>
                <th>Audience</th>
                <th>Group Avg</th>
                <th>Group Rank</th>
                {participants.map((person) => (
                  <th key={person.id}>{person.displayName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.entry.id}>
                  <td>#{row.officialRank}</td>
                  <td>{row.entry.country}</td>
                  <td>
                    <strong>{row.entry.song}</strong>
                    <span>{row.entry.artist}</span>
                  </td>
                  <td>{row.officialPoints ?? "--"}</td>
                  <td>{row.entry.officialJuryPoints ?? "--"}</td>
                  <td>{row.entry.officialAudiencePoints ?? "--"}</td>
                  <td>{row.groupAverage == null ? "--" : formatScore(row.groupAverage)}</td>
                  <td>
                    <RankComparisonChip rank={row.groupRank} delta={row.groupDelta} />
                  </td>
                  {row.participantRanks.map((item) => (
                    <td key={item.person.id}>
                      <RankComparisonChip rank={item.rank} delta={item.delta} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-copy">Official placements will appear here after import or manual entry in Admin.</p>
      )}
    </section>
  );
}

function RankComparisonChip({ rank, delta }) {
  if (!Number.isFinite(rank)) return <span className="rank-chip missing">--</span>;
  if (delta === 0) return <span className="rank-chip exact">#{rank}</span>;
  if (delta < 0) return <span className="rank-chip high">#{rank}</span>;
  return <span className="rank-chip low">#{rank}</span>;
}

function ResultsInsights({ disagreements, closestRankers, groupGaps, consensus }) {
  return (
    <section className="insights-section">
      <div className="section-heading">
        <h3>Insights</h3>
        <p>Where the Group agreed, drifted, and accidentally became Europe.</p>
      </div>
      <div className="insights-grid">
        <InsightBlock title="Biggest Disagreements" icon={Sparkles}>
          {disagreements.length ? (
            disagreements.map((entry, index) => (
              <ResultLine
                key={entry.id}
                rank={index + 1}
                entry={entry}
                value={`spread ${formatScore(entry.scoreSpread)}`}
              />
            ))
          ) : (
            <p className="empty-copy">No dramatic disagreements yet.</p>
          )}
        </InsightBlock>
        <InsightBlock title="Closest To Official" icon={Award}>
          {closestRankers.length ? (
            closestRankers.slice(0, 5).map((item, index) => (
              <InsightLine
                key={item.person.id}
                rank={index + 1}
                title={item.person.displayName}
                detail={`${formatScore(item.averageMiss)} average places off`}
                value={`${item.totalMiss} total`}
              />
            ))
          ) : (
            <p className="empty-copy">Import official placements to crown the closest ranker.</p>
          )}
        </InsightBlock>
        <InsightBlock title="Group vs Official Gaps" icon={BarChart3}>
          {groupGaps.length ? (
            groupGaps.map((row, index) => (
              <InsightLine
                key={row.entry.id}
                rank={index + 1}
                title={row.entry.country}
                detail={`${row.entry.song} by ${row.entry.artist}`}
                value={formatOfficialGap(row)}
              />
            ))
          ) : (
            <p className="empty-copy">Official placements will reveal the Group's boldest misses.</p>
          )}
        </InsightBlock>
        <InsightBlock title="Tightest Consensus" icon={Crown}>
          {consensus.length ? (
            consensus.map((item, index) => (
              <InsightLine
                key={item.entry.id}
                rank={index + 1}
                title={item.entry.country}
                detail={`${item.entry.song} by ${item.entry.artist}`}
                value={`spread ${formatScore(item.spread)}`}
              />
            ))
          ) : (
            <p className="empty-copy">Add at least two scores per song to see consensus picks.</p>
          )}
        </InsightBlock>
      </div>
    </section>
  );
}

function InsightBlock({ title, icon: Icon, children }) {
  return (
    <section className="insight-block">
      <h4><Icon size={17} /> {title}</h4>
      <div className="panel-list">{children}</div>
    </section>
  );
}

function formatOfficialGap(row) {
  if (!Number.isFinite(row.groupRank)) return `Official #${row.officialRank}; Group unranked`;
  if (row.groupDelta === 0) return `Matched official #${row.officialRank}`;
  const direction = row.groupDelta < 0 ? "overrated by Group" : "underrated by Group";
  return `Official #${row.officialRank}; Group #${row.groupRank} (${direction})`;
}

function InsightLine({ rank, title, detail, value }) {
  return (
    <article className="insight-line">
      <span className="result-rank">{rank}</span>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <output>{value}</output>
    </article>
  );
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{title}</h3>
        <p>{description}</p>
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-action" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function AdminView({ entries, state, setState, setConfig, setError, config }) {
  const [adminPin, setAdminPin] = useState(localStorage.getItem("eurovision-admin-pin") || "");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState({});
  const [saveStatuses, setSaveStatuses] = useState({});
  const saveTimers = useRef(new Map());

  useEffect(
    () => () => {
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      saveTimers.current.clear();
    },
    []
  );

  const draftFor = (entry) => ({
    grandFinalOrder: entry.grandFinalOrder || "",
    finalPlace: entry.finalPlace || "",
    officialTotalPoints: entry.officialTotalPoints ?? "",
    officialJuryPoints: entry.officialJuryPoints ?? "",
    officialAudiencePoints: entry.officialAudiencePoints ?? "",
    ...(drafts[entry.id] || {})
  });

  async function adminAction(path, body) {
    setError("");
    setNotice("");
    setBusy(path);
    try {
      localStorage.setItem("eurovision-admin-pin", adminPin);
      const data = await api(path, { method: "POST", body: { adminPin, ...body } });
      if (data.state) setState(data.state);
      if (typeof data.watcherRunning === "boolean") {
        setConfig((current) => ({ ...current, watcherRunning: data.watcherRunning }));
      }
      setNotice(adminNotice(path, data, body));
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  function adminNotice(path, data, body) {
    if (path === "/api/admin/import-official") {
      const seen = data.result?.entriesSeen ?? data.state?.entries?.length ?? 0;
      const changed = data.result?.changed ?? 0;
      return `Official pull complete: ${seen} entries checked, ${changed} database updates applied.`;
    }
    if (path === "/api/admin/watcher") {
      return data.watcherRunning ? "Official watcher is running." : "Official watcher is stopped.";
    }
    if (path === "/api/admin/reset-room") {
      return "Room reset complete. Local scores and claimed names were cleared.";
    }
    if (path === "/api/admin/official-result") {
      return "Official result saved.";
    }
    if (path === "/api/admin/official-results") {
      const changed = data.result?.changed ?? body.entries?.length ?? 0;
      return `Calculated official results saved: ${changed} rows updated.`;
    }
    return "Admin action complete.";
  }

  function officialPayload(entryId, draft) {
    return {
      id: entryId,
      grandFinalOrder: Number(draft.grandFinalOrder) || null,
      finalPlace: Number(draft.finalPlace) || null,
      officialTotalPoints: draft.officialTotalPoints === "" ? null : Number(draft.officialTotalPoints),
      officialJuryPoints: draft.officialJuryPoints === "" ? null : Number(draft.officialJuryPoints),
      officialAudiencePoints: draft.officialAudiencePoints === "" ? null : Number(draft.officialAudiencePoints)
    };
  }

  async function saveOfficialDraft(entryId, draft) {
    setSaveStatuses((current) => ({
      ...current,
      [entryId]: { state: "saving", message: "Saving..." }
    }));
    try {
      const data = await api("/api/admin/official-result", {
        method: "POST",
        body: { adminPin, entry: officialPayload(entryId, draft) }
      });
      if (data.state) setState(data.state);
      setSaveStatuses((current) => ({
        ...current,
        [entryId]: { state: "saved", message: "Saved" }
      }));
    } catch (err) {
      setSaveStatuses((current) => ({
        ...current,
        [entryId]: { state: "error", message: "Could not save" }
      }));
      setError(err.message);
    }
  }

  function numberFromDraft(value) {
    if (value === "" || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clearSaveTimers(entryIds) {
    for (const entryId of entryIds) {
      const timer = saveTimers.current.get(entryId);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(entryId);
    }
  }

  async function saveCalculatedEntries(calculatedDrafts) {
    const entryIds = calculatedDrafts.map(({ entry }) => entry.id);
    if (!entryIds.length) {
      setError("No rows have enough data to calculate.");
      return;
    }

    clearSaveTimers(entryIds);
    setError("");
    setNotice("");
    setBusy("/api/admin/official-results");
    setDrafts((current) => {
      const next = { ...current };
      for (const { entry, draft } of calculatedDrafts) {
        next[entry.id] = draft;
      }
      return next;
    });
    setSaveStatuses((current) => {
      const next = { ...current };
      for (const entryId of entryIds) {
        next[entryId] = { state: "saving", message: "Saving..." };
      }
      return next;
    });

    try {
      localStorage.setItem("eurovision-admin-pin", adminPin);
      const entriesPayload = calculatedDrafts.map(({ entry, draft }) => officialPayload(entry.id, draft));
      const data = await api("/api/admin/official-results", {
        method: "POST",
        body: { adminPin, entries: entriesPayload }
      });
      if (data.state) setState(data.state);
      setNotice(adminNotice("/api/admin/official-results", data, { entries: entriesPayload }));
      setSaveStatuses((current) => {
        const next = { ...current };
        for (const entryId of entryIds) {
          next[entryId] = { state: "saved", message: "Saved" };
        }
        return next;
      });
    } catch (err) {
      setError(err.message);
      setSaveStatuses((current) => {
        const next = { ...current };
        for (const entryId of entryIds) {
          next[entryId] = { state: "error", message: "Could not save" };
        }
        return next;
      });
    } finally {
      setBusy("");
    }
  }

  function calculateTotals() {
    const calculatedDrafts = entries
      .map((entry) => {
        const draft = draftFor(entry);
        const jury = numberFromDraft(draft.officialJuryPoints);
        const audience = numberFromDraft(draft.officialAudiencePoints);
        if (jury == null || audience == null) return null;
        return {
          entry,
          draft: {
            ...draft,
            officialTotalPoints: jury + audience
          }
        };
      })
      .filter(Boolean);
    saveCalculatedEntries(calculatedDrafts);
  }

  function calculatePlaces() {
    const rankedEntries = entries
      .map((entry) => {
        const draft = draftFor(entry);
        return {
          entry,
          draft,
          total: numberFromDraft(draft.officialTotalPoints),
          jury: numberFromDraft(draft.officialJuryPoints) ?? -1,
          audience: numberFromDraft(draft.officialAudiencePoints) ?? -1
        };
      })
      .filter((item) => item.total != null)
      .sort(
        (a, b) =>
          b.total - a.total ||
          b.audience - a.audience ||
          b.jury - a.jury ||
          a.entry.country.localeCompare(b.entry.country)
      );
    if (!rankedEntries.length) {
      saveCalculatedEntries([]);
      return;
    }
    const placeByEntryId = new Map(rankedEntries.map((item, index) => [item.entry.id, index + 1]));

    const calculatedDrafts = entries.map((entry) => ({
      entry,
      draft: {
        ...draftFor(entry),
        finalPlace: placeByEntryId.get(entry.id) || ""
      }
    }));
    saveCalculatedEntries(calculatedDrafts);
  }

  function updateOfficialDraft(entry, field, value) {
    const nextDraft = { ...draftFor(entry), [field]: value };
    setDrafts((all) => ({ ...all, [entry.id]: nextDraft }));
    setSaveStatuses((current) => ({
      ...current,
      [entry.id]: { state: "pending", message: "Waiting..." }
    }));

    const existingTimer = saveTimers.current.get(entry.id);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      saveTimers.current.delete(entry.id);
      saveOfficialDraft(entry.id, nextDraft);
    }, 700);
    saveTimers.current.set(entry.id, timer);
  }

  async function unlockAdmin(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy("/api/admin/verify");
    try {
      await api("/api/admin/verify", { method: "POST", body: { adminPin } });
      localStorage.setItem("eurovision-admin-pin", adminPin);
      setAdminUnlocked(true);
      setNotice("Admin unlocked.");
    } catch (err) {
      setAdminUnlocked(false);
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="view-stack">
      <ViewHeader
        icon={Settings}
        title="Admin Controls"
        description="Official results and room operations. Rankings are calculated automatically from scores."
      />
      {!adminUnlocked ? (
        <form className="admin-lock-panel" onSubmit={unlockAdmin}>
          <Lock size={28} />
          <div>
            <h3>Admin PIN Required</h3>
            <p>Enter the admin PIN to access official results and room controls.</p>
          </div>
          <label>
            Admin PIN
            <input
              value={adminPin}
              onChange={(event) => setAdminPin(event.target.value)}
              type="password"
              placeholder="Default: 1234"
              autoComplete="current-password"
            />
          </label>
          <button className="primary-action" type="submit" disabled={!!busy}>
            <Lock size={16} />
            Unlock Admin
          </button>
        </form>
      ) : (
        <>
      <div className="admin-toolbar">
        <button type="button" onClick={() => adminAction("/api/admin/import-official", {})} disabled={!!busy}>
          <RefreshCw size={16} />
          Pull official now
        </button>
        <button type="button" onClick={calculateTotals} disabled={!!busy}>
          <Calculator size={16} />
          Calculate Total
        </button>
        <button type="button" onClick={calculatePlaces} disabled={!!busy}>
          <Trophy size={16} />
          Calculate Place
        </button>
        <button
          type="button"
          onClick={() => adminAction("/api/admin/watcher", { enabled: !config.watcherRunning })}
          disabled={!!busy}
        >
          <RefreshCw size={16} />
          Toggle watcher
        </button>
        <button type="button" onClick={() => setConfirmReset(true)} disabled={!!busy}>
          <RefreshCw size={16} />
          Reset local room
        </button>
      </div>
      {notice && <div className="success-banner">{notice}</div>}
      {confirmReset && (
        <ConfirmDialog
          title="Reset local room?"
          description="This clears all local scores and joined people. Everyone will be sent back to the join screen."
          confirmLabel="Reset room"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            adminAction("/api/admin/reset-room", {});
          }}
        />
      )}
      <div className="admin-table">
        {entries.map((entry) => {
          const draft = draftFor(entry);
          const status = saveStatuses[entry.id];
          return (
            <article key={entry.id} className="admin-row">
              <SongMini entry={entry} />
              <div className="admin-inputs">
                {[
                  ["grandFinalOrder", "Run"],
                  ["finalPlace", "Place"],
                  ["officialTotalPoints", "Total"],
                  ["officialJuryPoints", "Jury"],
                  ["officialAudiencePoints", "Audience"]
                ].map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <input
                      inputMode="numeric"
                      value={draft[field]}
                      onChange={(event) => updateOfficialDraft(entry, field, event.target.value)}
                    />
                  </label>
                ))}
                <span className={cx("autosave-status", status?.state)} aria-live="polite">
                  {status?.message || ""}
                </span>
              </div>
            </article>
          );
        })}
      </div>
        </>
      )}
    </section>
  );
}

function SongPreviewRow({ entry }) {
  const [open, setOpen] = useState(false);
  const embedUrl = youtubeEmbedUrl(entry.youtubeUrl);
  function toggleOpen() {
    if (embedUrl) setOpen((value) => !value);
  }

  return (
    <article
      className={cx("song-preview-row", embedUrl && "clickable", open && "open")}
      onClick={toggleOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleOpen();
      }}
      role={embedUrl ? "button" : undefined}
      tabIndex={embedUrl ? 0 : undefined}
      aria-expanded={embedUrl ? open : undefined}
    >
      <div className="preview-image-wrap">
        {entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" /> : <div className="image-fallback" />}
      </div>
      <div className="song-preview-main">
        <SongMini entry={entry} badge={orderBadge(entry)} large />
        <p className="preview-description">
          {entry.artistBio || "Artist bio is not reliably available yet. The importer will refresh it when Eurovision publishes more detail."}
        </p>
      </div>
      <div className="song-preview-actions">
        {embedUrl && (
          <span className="icon-link">
            <Play size={16} />
            {open ? "Hide video" : "Play"}
          </span>
        )}
      </div>
      {open && embedUrl && (
        <div className="inline-video" onClick={(event) => event.stopPropagation()}>
          <iframe
            src={embedUrl}
            title={`${entry.country}: ${entry.song}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )}
    </article>
  );
}

function SongMini({ entry, large = false, badge = orderBadge(entry) }) {
  return (
    <div className={cx("song-mini", large && "large", badge == null && "no-badge")}>
      {badge != null && <span className="country-code">{badge}</span>}
      <div>
        <h3>{entry.country}</h3>
        <p>{entry.song} - {entry.artist}</p>
      </div>
    </div>
  );
}

function ViewHeader({ icon: Icon, title, description }) {
  return (
    <header className="view-header">
      <div className="view-icon"><Icon size={22} /></div>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function ScorePanel({ title, icon: Icon, children }) {
  return (
    <section className="score-panel">
      <h3><Icon size={18} /> {title}</h3>
      <div className="panel-list">{children}</div>
    </section>
  );
}

function ResultLine({ rank, entry, value }) {
  return (
    <div className="result-line">
      <span className="result-rank">{rank}</span>
      <span className="result-title">{formatEntry(entry)}</span>
      <span className="result-value">{value}</span>
    </div>
  );
}
