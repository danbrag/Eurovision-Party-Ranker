import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import confetti from "canvas-confetti";
import {
  Award,
  BarChart3,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crown,
  Download,
  Eye,
  Lock,
  Minus,
  Music2,
  PartyPopper,
  Plus,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Star,
  Trophy,
  UserPlus,
  Users,
  XCircle
} from "lucide-react";
import { api, browserToken } from "./api.js";
import {
  averageScores,
  biggestDisagreements,
  finalEntries,
  scoreMap,
  tastePredictionGaps
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

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(12, Math.max(0, Math.round(number * 4) / 4));
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
  const enjoymentLookup = scoreMap(scores, "enjoyment");
  const predictionLookup = scoreMap(scores, "prediction");
  return entries.every(
    (entry) =>
      enjoymentLookup.has(`${participantId}:${entry.id}`) &&
      predictionLookup.has(`${participantId}:${entry.id}`)
  );
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
  const ownEnjoymentScores = useMemo(() => scoreMap(state.scores || [], "enjoyment"), [state.scores]);
  const ownPredictionScores = useMemo(() => scoreMap(state.scores || [], "prediction"), [state.scores]);
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

  async function updateScore(entryId, scoreType, score) {
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
          scoreType,
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
            enjoymentLookup={ownEnjoymentScores}
            predictionLookup={ownPredictionScores}
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

function ScoreView({ entries, participant, enjoymentLookup, predictionLookup, onScore }) {
  const [draftScores, setDraftScores] = useState({});
  const [boardMetric, setBoardMetric] = useState("enjoyment");
  const pendingScores = useRef(new Map());
  const displayEnjoymentLookup = useMemo(() => {
    const next = new Map(enjoymentLookup);
    for (const [key, value] of Object.entries(draftScores)) {
      const [metric, entryId] = key.split(":");
      if (metric === "enjoyment") next.set(`${participant.id}:${entryId}`, value);
    }
    return next;
  }, [draftScores, enjoymentLookup, participant.id]);
  const displayPredictionLookup = useMemo(() => {
    const next = new Map(predictionLookup);
    for (const [key, value] of Object.entries(draftScores)) {
      const [metric, entryId] = key.split(":");
      if (metric === "prediction") next.set(`${participant.id}:${entryId}`, value);
    }
    return next;
  }, [draftScores, participant.id, predictionLookup]);
  const activeLookup = boardMetric === "prediction" ? displayPredictionLookup : displayEnjoymentLookup;
  const rankedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const aScore = activeLookup.get(`${participant.id}:${a.id}`);
        const bScore = activeLookup.get(`${participant.id}:${b.id}`);
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
    [activeLookup, entries, participant.id]
  );

  useEffect(() => {
    setDraftScores((current) => {
      const next = { ...current };
      let changed = false;
      for (const [draftKey, value] of Object.entries(current)) {
        const [metric, entryId] = draftKey.split(":");
        const lookup = metric === "prediction" ? predictionLookup : enjoymentLookup;
        const saved = lookup.get(`${participant.id}:${entryId}`) ?? 0;
        if (saved === value) {
          delete next[draftKey];
          pendingScores.current.delete(draftKey);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [enjoymentLookup, participant.id, predictionLookup]);

  function draftScore(entryId, metric, value) {
    setDraftScores((current) => ({ ...current, [`${metric}:${entryId}`]: value }));
  }

  function commitScore(entryId, metric, value) {
    const lookup = metric === "prediction" ? predictionLookup : enjoymentLookup;
    const key = `${metric}:${entryId}`;
    const saved = lookup.get(`${participant.id}:${entryId}`) ?? 0;
    if (saved === value || pendingScores.current.get(key) === value) return;
    pendingScores.current.set(key, value);
    Promise.resolve(onScore(entryId, metric, value)).finally(() => {
      if (pendingScores.current.get(key) === value) pendingScores.current.delete(key);
    });
  }

  return (
    <section className="view-stack">
      <ViewHeader
        icon={Star}
        title="My Rankings"
        description="Score each song two ways: how much you enjoyed it, and how well you think Eurovision will rank it."
      />
      <div className="ranking-workspace">
        <section className="ranking-input-panel" aria-label="Performance-order scoring">
          <h3>Score In Performance Order</h3>
          <div className="score-list">
            {entries.map((entry) => {
              const savedEnjoyment = enjoymentLookup.get(`${participant.id}:${entry.id}`) ?? 0;
              const savedPrediction = predictionLookup.get(`${participant.id}:${entry.id}`) ?? 0;
              const enjoymentScore = draftScores[`enjoyment:${entry.id}`] ?? savedEnjoyment;
              const predictionScore = draftScores[`prediction:${entry.id}`] ?? savedPrediction;
              return (
                <article key={entry.id} className="score-row score-input-row">
                  <span className="performance-order">{orderBadge(entry)}</span>
                  <div className="score-thumb">
                    {entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" /> : <div className="image-fallback" />}
                  </div>
                  <SongMini entry={entry} badge={null} />
                  <div className="dual-score-controls">
                    <ScoreSlider
                      label="Enjoyment"
                      entry={entry}
                      metric="enjoyment"
                      value={enjoymentScore}
                      onDraft={draftScore}
                      onCommit={commitScore}
                    />
                    <ScoreSlider
                      label="Judges"
                      entry={entry}
                      metric="prediction"
                      value={predictionScore}
                      onDraft={draftScore}
                      onCommit={commitScore}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <section className="ranking-board-panel" aria-label="Score-derived ranking board">
          <div className="ranking-board-header">
            <h3>Your Ranking Board</h3>
            <div className="segmented-control" aria-label="Ranking board score lens">
              {[
                ["enjoyment", "Taste"],
                ["prediction", "Judges"]
              ].map(([metric, label]) => (
                <button
                  key={metric}
                  type="button"
                  className={cx(boardMetric === metric && "active")}
                  aria-pressed={boardMetric === metric}
                  onClick={() => setBoardMetric(metric)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <RankingBoardList
            entries={rankedEntries}
            participantId={participant.id}
            enjoymentLookup={enjoymentLookup}
            predictionLookup={predictionLookup}
            displayEnjoymentLookup={displayEnjoymentLookup}
            displayPredictionLookup={displayPredictionLookup}
            metric={boardMetric}
          />
        </section>
      </div>
    </section>
  );
}

function ScoreSlider({ label, entry, metric, value, onDraft, onCommit }) {
  const inputId = useId();
  const step = 0.25;

  function update(value) {
    const nextValue = normalizeScore(value);
    onDraft(entry.id, metric, nextValue);
    onCommit(entry.id, metric, nextValue);
  }

  return (
    <div className={cx("score-controls", metric === "prediction" && "prediction")}>
      <label htmlFor={inputId}>{label}</label>
      <div className="score-stepper">
        <button
          type="button"
          onClick={() => update(value - step)}
          disabled={value <= 0}
          aria-label={`Decrease ${label} score for ${formatEntry(entry)}`}
        >
          <Minus size={16} />
        </button>
        <output htmlFor={inputId}>{formatScore(value)}</output>
        <button
          type="button"
          onClick={() => update(value + step)}
          disabled={value >= 12}
          aria-label={`Increase ${label} score for ${formatEntry(entry)}`}
        >
          <Plus size={16} />
        </button>
      </div>
      <input
        id={inputId}
        type="range"
        min="0"
        max="12"
        step="0.25"
        value={value}
        onChange={(event) => onDraft(entry.id, metric, normalizeScore(event.target.value))}
        onPointerUp={(event) => onCommit(entry.id, metric, Number(event.currentTarget.value))}
        onTouchEnd={(event) => onCommit(entry.id, metric, Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit(entry.id, metric, Number(event.currentTarget.value))}
        onBlur={(event) => onCommit(entry.id, metric, Number(event.currentTarget.value))}
        aria-label={`${label} score for ${formatEntry(entry)}`}
      />
    </div>
  );
}

function RankingBoardList({
  entries,
  participantId,
  enjoymentLookup,
  predictionLookup,
  displayEnjoymentLookup,
  displayPredictionLookup,
  metric
}) {
  const listRef = useRef(null);
  const positions = useRef(new Map());
  const rowAnimations = useRef(new WeakMap());
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
          const previousAnimation = rowAnimations.current.get(row);
          if (previousAnimation) previousAnimation.cancel();

          row.style.zIndex = "2";
          const animation = row.animate(
            [
              { transform: `translate3d(0, ${deltaY}px, 0)` },
              { transform: "translate3d(0, 0, 0)" }
            ],
            {
              duration: 900,
              easing: "cubic-bezier(0.19, 1, 0.22, 1)"
            }
          );
          rowAnimations.current.set(row, animation);
          animation.finished.catch(() => {}).then(() => {
            if (rowAnimations.current.get(row) === animation) {
              row.style.zIndex = "";
              rowAnimations.current.delete(row);
            }
          });
        }
      }
      nextPositions.set(id, { top: rect.top });
    }
    positions.current = nextPositions;
  }, [orderKey]);

  return (
    <>
      <div className="ranking-board-column-labels" aria-hidden="true">
        <span>Song</span>
        <span>Taste</span>
        <span>Judges</span>
      </div>
      <div ref={listRef} className="ranking-board-list">
        {entries.map((entry, index) => (
          <RankingBoardRow
            key={entry.id}
            entry={entry}
            rank={index + 1}
            enjoymentScore={(displayEnjoymentLookup || enjoymentLookup).get(`${participantId}:${entry.id}`)}
            predictionScore={(displayPredictionLookup || predictionLookup).get(`${participantId}:${entry.id}`)}
            metric={metric}
          />
        ))}
      </div>
    </>
  );
}

function RankingBoardRow({ entry, rank, enjoymentScore, predictionScore, metric }) {
  return (
    <article className="ranking-board-row" data-rank-id={entry.id}>
      <span className="personal-rank">#{rank}</span>
      <div className="ranking-board-song">
        <strong>{entry.country}</strong>
        <span>{entry.song} by {entry.artist}</span>
      </div>
      <output
        className={cx("ranking-score-cell", metric === "enjoyment" ? "active" : "muted")}
        title="Taste score"
      >
        {enjoymentScore == null ? "--" : formatScore(enjoymentScore)}
      </output>
      <output
        className={cx("ranking-score-cell", "prediction", metric === "prediction" ? "active" : "muted")}
        title="Judges score"
      >
        {predictionScore == null ? "--" : formatScore(predictionScore)}
      </output>
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

function buildResultsAnalysis(entries, participants, scores, enjoymentAverages, predictionAverages) {
  const predictionLookup = scoreMap(scores, "prediction");
  const enjoymentAverageLookup = new Map(enjoymentAverages.map((entry) => [entry.id, entry.average]));
  const predictionAverageLookup = new Map(predictionAverages.map((entry) => [entry.id, entry.average]));
  const groupRanks = rankEntriesByScore(entries, (entry) => predictionAverageLookup.get(entry.id));
  const participantRanks = new Map(
    participants.map((person) => [
      person.id,
      rankEntriesByScore(entries, (entry) => predictionLookup.get(`${person.id}:${entry.id}`))
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
        groupAverage: predictionAverageLookup.get(entry.id),
        groupTasteAverage: enjoymentAverageLookup.get(entry.id),
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
        .map((score) => Number(score.enjoymentScore ?? score.score))
        .filter(Number.isFinite);
      const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : null;
      return {
        entry,
        spread,
        count: values.length,
        average: enjoymentAverageLookup.get(entry.id)
      };
    })
    .filter((item) => item.spread != null)
    .sort((a, b) => a.spread - b.spread || (b.average ?? -1) - (a.average ?? -1))
    .slice(0, 5);

  return { officialRows, closestRankers, groupGaps, consensus };
}

function ResultsView({ entries, participants, scores, officialVotes, allScored }) {
  const [sort, setSort] = useState({ key: "order", direction: "asc" });
  const averages = averageScores(entries, participants, scores, "enjoyment");
  const predictionAverages = averageScores(entries, participants, scores, "prediction");
  const disagreements = biggestDisagreements(entries, participants, scores, "enjoyment");
  const predictionDisagreements = biggestDisagreements(entries, participants, scores, "prediction");
  const scoreGaps = tastePredictionGaps(entries, participants, scores);
  const analysis = useMemo(
    () => buildResultsAnalysis(entries, participants, scores, averages, predictionAverages),
    [entries, participants, scores, averages, predictionAverages]
  );

  return (
    <section className="view-stack">
      <ViewHeader
        icon={Trophy}
        title="Scoreboards"
        description={allScored ? "Everyone scored taste and judges for every finalist. Crown the Winner." : "Live taste scores and judges scores update here as everyone votes."}
      />
      {allScored && (
        <div className="celebration-banner">
          <PartyPopper size={20} />
          Everyone scored taste and judges for every finalist.
        </div>
      )}
      <ResultScoreTable
        entries={entries}
        participants={participants}
        scores={scores}
        averages={averages}
        predictionAverages={predictionAverages}
        sort={sort}
        setSort={setSort}
      />
      <OfficialResultsTable rows={analysis.officialRows} participants={participants} officialVotes={officialVotes} />
      <ResultsInsights
        disagreements={disagreements}
        predictionDisagreements={predictionDisagreements}
        closestRankers={analysis.closestRankers}
        groupGaps={analysis.groupGaps}
        consensus={analysis.consensus}
        scoreGaps={scoreGaps}
      />
      <ResultsWinnerCard standings={analysis.closestRankers} officialRows={analysis.officialRows} />
    </section>
  );
}

function ResultsWinnerCard({ standings, officialRows }) {
  const [expanded, setExpanded] = useState(false);
  const [openPersonId, setOpenPersonId] = useState(null);
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
  const officialCount = officialRows.length;
  const activePersonId = openPersonId;

  const comparisonByPerson = useMemo(() => {
    const map = new Map();
    for (const item of standings) {
      const rows = officialRows
        .map((row) => {
          const participantRank = row.participantRanks.find(
            (rankItem) => rankItem.person.id === item.person.id
          );
          return {
            entry: row.entry,
            officialRank: row.officialRank,
            rank: participantRank?.rank,
            delta: participantRank?.delta
          };
        })
        .filter((row) => Number.isFinite(row.rank))
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            a.officialRank - b.officialRank ||
            a.entry.country.localeCompare(b.entry.country)
        );
      map.set(item.person.id, rows);
    }
    return map;
  }, [officialRows, standings]);

  function togglePerson(personId) {
    setExpanded(true);
    setOpenPersonId((current) => (current === personId ? null : personId));
  }

  return (
    <section className={cx("winner-accordion", expanded && "open")}>
      <button
        className="winner-accordion-toggle"
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide winner" : "Reveal winner"}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="winner-toggle-icon">
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </span>
          <span>
          <span className="eyebrow">Judges Winner</span>
          <strong>
            {expanded
              ? winner
                ? isTie
                  ? `Tie: ${winnerNames}`
                  : winner.person.displayName
                : "Waiting for official results"
              : "Reveal"}
          </strong>
        </span>
        {winner && <output>{expanded ? `${formatScore(winner.averageMiss)} avg off` : "Hidden"}</output>}
      </button>
      <div className="winner-accordion-shell" aria-hidden={!expanded}>
        <div className="winner-accordion-body">
          <div className="winner-detail-summary">
            <div className="winner-icon"><Trophy size={22} /></div>
            <div>
              <h3>{winner ? (isTie ? `Tie: ${winnerNames}` : winner.person.displayName) : "Waiting for official results"}</h3>
              <p>
                {winner
                ? `Closest to the official final order using judges scores, averaging ${formatScore(winner.averageMiss)} places off across ${winner.compared} ${winner.compared === 1 ? "song" : "songs"}.`
                  : "Add official placements and judges scores to crown the closest ranker."}
              </p>
            </div>
          </div>
          <div className="winner-standings">
            {standings.length ? (
              standings.map((item, index) => {
                const personRows = comparisonByPerson.get(item.person.id) || [];
                const personOpen = activePersonId === item.person.id;
                return (
                  <article
                    key={item.person.id}
                    className={cx("winner-standing", index === 0 && "first", personOpen && "open")}
                  >
                    <button
                      type="button"
                      className="winner-standing-button"
                      aria-expanded={personOpen}
                      onClick={() => togglePerson(item.person.id)}
                    >
                      <span>{index + 1}</span>
                      <strong>{item.person.displayName}</strong>
                      <output>{item.totalMiss} total off</output>
                      <small>{item.exactMatches} of {item.compared || officialCount} exact</small>
                    </button>
                    <div className="person-order-shell" aria-hidden={!personOpen}>
                      <div className="person-order-panel">
                        <div className="person-order-header">
                          <span>Your Rank</span>
                          <span>Song</span>
                          <span>Official</span>
                          <span>Off By</span>
                        </div>
                        <div className="person-order-list">
                          {personRows.length ? (
                            personRows.map((row) => (
                              <PersonOrderRow key={row.entry.id} row={row} />
                            ))
                          ) : (
                            <p className="empty-copy">No official comparison yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="empty-copy">No standings yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonOrderRow({ row }) {
  const exact = row.delta === 0;
  const direction = row.delta < 0 ? "high" : "low";
  const label = exact ? "Exact" : row.delta < 0 ? `${Math.abs(row.delta)} too high` : `${row.delta} too low`;

  return (
    <article className={cx("person-order-row", exact ? "exact" : direction)}>
      <span className="person-order-rank">#{row.rank}</span>
      <div className="person-order-song">
        <strong>{row.entry.country}</strong>
        <span>{row.entry.song} by {row.entry.artist}</span>
      </div>
      <span className="official-rank-pill">Official #{row.officialRank}</span>
      <span className="verdict-pill">
        {exact ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
        {label}
      </span>
    </article>
  );
}

function ResultScoreTable({ entries, participants, scores, averages, predictionAverages, sort, setSort }) {
  const [collapsed, setCollapsed] = useState(false);
  const enjoymentLookup = scoreMap(scores, "enjoyment");
  const predictionLookup = scoreMap(scores, "prediction");
  const averageLookup = new Map(averages.map((entry) => [entry.id, entry.average]));
  const predictionAverageLookup = new Map(predictionAverages.map((entry) => [entry.id, entry.average]));

  function sortValue(entry, key) {
    if (key === "order") return entry.grandFinalOrder ?? 999;
    if (key === "country") return entry.country.toLowerCase();
    if (key === "artist") return entry.artist.toLowerCase();
    if (key === "song") return entry.song.toLowerCase();
    if (key === "average") return averageLookup.get(entry.id) ?? -1;
    if (key === "predictionAverage") return predictionAverageLookup.get(entry.id) ?? -1;
    if (key.startsWith("participant:")) {
      const [, metric, participantId] = key.split(":");
      const lookup = metric === "prediction" ? predictionLookup : enjoymentLookup;
      return lookup.get(`${participantId}:${entry.id}`) ?? -1;
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
          <p>Taste and judges scores are both out of 12. Default is performance order.</p>
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
                <button type="button" onClick={() => changeSort("average")}>Taste Avg{sortLabel("average")}</button>
              </th>
              <th>
                <button type="button" onClick={() => changeSort("predictionAverage")}>Judges Avg{sortLabel("predictionAverage")}</button>
              </th>
              {participants.map((person) => {
                const key = `participant:enjoyment:${person.id}`;
                const predictionKey = `participant:prediction:${person.id}`;
                return (
                  <th key={person.id} className="dual-score-heading">
                    <button type="button" onClick={() => changeSort(key)}>
                      {person.displayName} Taste{sortLabel(key)}
                    </button>
                    <button type="button" onClick={() => changeSort(predictionKey)}>
                      Judges{sortLabel(predictionKey)}
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
                <td>{predictionAverageLookup.get(entry.id) == null ? "--" : formatScore(predictionAverageLookup.get(entry.id))}</td>
                {participants.map((person) => {
                  const enjoyment = enjoymentLookup.get(`${person.id}:${entry.id}`);
                  const prediction = predictionLookup.get(`${person.id}:${entry.id}`);
                  return (
                    <td key={person.id}>
                      <span className="dual-score-cell">
                        <strong>{enjoyment == null ? "--" : formatScore(enjoyment)}</strong>
                        <span>{prediction == null ? "--" : formatScore(prediction)}</span>
                      </span>
                    </td>
                  );
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
          <p>Judges ranks are compared against the official place, while taste avg keeps the room's favorites visible.</p>
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
                <th>Taste Avg</th>
                <th>Judges Avg</th>
                <th>Judges Rank</th>
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
                  <td>{row.groupTasteAverage == null ? "--" : formatScore(row.groupTasteAverage)}</td>
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

function ResultsInsights({ disagreements, predictionDisagreements, closestRankers, groupGaps, consensus, scoreGaps }) {
  return (
    <section className="insights-section">
      <div className="section-heading">
        <h3>Insights</h3>
        <p>Where the Group agreed, judged, and split taste from strategy.</p>
      </div>
      <div className="insights-grid">
        <InsightBlock title="Biggest Taste Disagreements" icon={Sparkles}>
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
        <InsightBlock title="Judges Disagreements" icon={BarChart3}>
          {predictionDisagreements.length ? (
            predictionDisagreements.map((entry, index) => (
              <ResultLine
                key={entry.id}
                rank={index + 1}
                entry={entry}
                value={`spread ${formatScore(entry.scoreSpread)}`}
              />
            ))
          ) : (
            <p className="empty-copy">Judges drama appears once at least two people score a song.</p>
          )}
        </InsightBlock>
        <InsightBlock title="Best Crystal Ball" icon={Award}>
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
            <p className="empty-copy">Import official placements to crown the closest judges ranker.</p>
          )}
        </InsightBlock>
        <InsightBlock title="Judges vs Official Gaps" icon={BarChart3}>
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
        <InsightBlock title="Taste vs Judges Gaps" icon={Calculator}>
          {scoreGaps.length ? (
            scoreGaps.map((item, index) => (
              <InsightLine
                key={`${item.participant.id}:${item.entry.id}`}
                rank={index + 1}
                title={`${item.participant.displayName}: ${item.entry.country}`}
                detail={`${item.entry.song} by ${item.entry.artist}`}
                value={formatTastePredictionGap(item)}
              />
            ))
          ) : (
            <p className="empty-copy">Add both scores to find the biggest head-versus-heart moments.</p>
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

function formatTastePredictionGap(item) {
  if (item.gap > 0) {
    return `Judges score ${formatScore(item.absoluteGap)} higher than taste`;
  }
  return `Loved ${formatScore(item.absoluteGap)} more than judges score`;
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
  const direction = row.groupDelta < 0 ? "judges too high" : "judges too low";
  return `Official #${row.officialRank}; Judges #${row.groupRank} (${direction})`;
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

function exportDateStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function fileSafe(value) {
  return String(value || "eurovision")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function downloadTextFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvValue(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvTable(rows) {
  return rows.map((row) => row.map(csvValue).join(",")).join("\n");
}

function participantScoreRanks(entries, participants, scores, metric) {
  const lookup = scoreMap(scores, metric);
  return new Map(
    participants.map((person) => [
      person.id,
      rankEntriesByScore(entries, (entry) => lookup.get(`${person.id}:${entry.id}`))
    ])
  );
}

function buildAdminExport(entries, state) {
  const participants = state.participants || [];
  const scores = state.scores || [];
  const enjoymentLookup = scoreMap(scores, "enjoyment");
  const judgesLookup = scoreMap(scores, "prediction");
  const tasteAverages = averageScores(entries, participants, scores, "enjoyment");
  const judgesAverages = averageScores(entries, participants, scores, "prediction");
  const tasteAverageLookup = new Map(tasteAverages.map((entry) => [entry.id, entry.average]));
  const judgesAverageLookup = new Map(judgesAverages.map((entry) => [entry.id, entry.average]));
  const tasteRankLookup = rankEntriesByScore(entries, (entry) => tasteAverageLookup.get(entry.id));
  const judgesRankLookup = rankEntriesByScore(entries, (entry) => judgesAverageLookup.get(entry.id));
  const participantTasteRanks = participantScoreRanks(entries, participants, scores, "enjoyment");
  const participantJudgesRanks = participantScoreRanks(entries, participants, scores, "prediction");
  const analysis = buildResultsAnalysis(entries, participants, scores, tasteAverages, judgesAverages);

  const entryRows = entries.map((entry) => {
    const participantScores = participants.map((person) => ({
      participantId: person.id,
      displayName: person.displayName,
      tasteScore: enjoymentLookup.get(`${person.id}:${entry.id}`) ?? null,
      tasteRank: participantTasteRanks.get(person.id)?.get(entry.id) ?? null,
      judgesScore: judgesLookup.get(`${person.id}:${entry.id}`) ?? null,
      judgesRank: participantJudgesRanks.get(person.id)?.get(entry.id) ?? null
    }));

    return {
      id: entry.id,
      run: orderBadge(entry),
      country: entry.country,
      artist: entry.artist,
      song: entry.song,
      tasteAverage: tasteAverageLookup.get(entry.id) ?? null,
      tasteRank: tasteRankLookup.get(entry.id) ?? null,
      judgesAverage: judgesAverageLookup.get(entry.id) ?? null,
      judgesRank: judgesRankLookup.get(entry.id) ?? null,
      officialPlace: entry.finalPlace ?? null,
      officialTotalPoints: entry.officialTotalPoints ?? null,
      officialJuryPoints: entry.officialJuryPoints ?? null,
      officialAudiencePoints: entry.officialAudiencePoints ?? null,
      participantScores
    };
  });

  return {
    exportedAt: new Date().toISOString(),
    room: state.room,
    participants,
    entries: entryRows,
    closestJudgesRankers: analysis.closestRankers.map((item) => ({
      participantId: item.person.id,
      displayName: item.person.displayName,
      compared: item.compared,
      exactMatches: item.exactMatches,
      totalMiss: item.totalMiss,
      averageMiss: item.averageMiss
    })),
    officialVotes: state.officialVotes || []
  };
}

function adminExportCsv(exportData) {
  const participants = exportData.participants || [];
  const header = [
    "Run",
    "Country",
    "Artist",
    "Song",
    "Taste Avg",
    "Taste Rank",
    "Judges Avg",
    "Judges Rank",
    "Official Place",
    "Official Total",
    "Official Jury",
    "Official Audience",
    ...participants.flatMap((person) => [
      `${person.displayName} Taste Score`,
      `${person.displayName} Taste Rank`,
      `${person.displayName} Judges Score`,
      `${person.displayName} Judges Rank`
    ])
  ];

  const rows = exportData.entries.map((entry) => {
    const scoresByPerson = new Map(entry.participantScores.map((score) => [score.participantId, score]));
    return [
      entry.run,
      entry.country,
      entry.artist,
      entry.song,
      entry.tasteAverage,
      entry.tasteRank,
      entry.judgesAverage,
      entry.judgesRank,
      entry.officialPlace,
      entry.officialTotalPoints,
      entry.officialJuryPoints,
      entry.officialAudiencePoints,
      ...participants.flatMap((person) => {
        const score = scoresByPerson.get(person.id) || {};
        return [score.tasteScore, score.tasteRank, score.judgesScore, score.judgesRank];
      })
    ];
  });

  return csvTable([header, ...rows]);
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

  function exportAnalysisData(format) {
    setError("");
    const exportData = buildAdminExport(entries, state);
    const roomCode = fileSafe(state.room?.roomCode || config?.roomCode || "room");
    const stamp = exportDateStamp();
    if (format === "csv") {
      downloadTextFile(
        `eurovision-${roomCode}-rankings-results-${stamp}.csv`,
        adminExportCsv(exportData),
        "text/csv;charset=utf-8"
      );
      setNotice("CSV export downloaded.");
      return;
    }

    downloadTextFile(
      `eurovision-${roomCode}-rankings-results-${stamp}.json`,
      JSON.stringify(exportData, null, 2),
      "application/json;charset=utf-8"
    );
    setNotice("JSON export downloaded.");
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
              placeholder="Enter admin PIN"
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
          <section className="admin-export-panel">
            <div>
              <h3>Export Analysis Data</h3>
              <p>Download current scores, room rankings, judges rankings, and official results for post-show analysis.</p>
            </div>
            <div className="admin-export-actions">
              <button type="button" onClick={() => exportAnalysisData("csv")}>
                <Download size={16} />
                Export CSV
              </button>
              <button type="button" onClick={() => exportAnalysisData("json")}>
                <Download size={16} />
                Export JSON
              </button>
            </div>
          </section>
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
