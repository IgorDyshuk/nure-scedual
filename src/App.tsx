import { format, isSameDay } from "date-fns";
import "./App.css";
import Papa, { type ParseResult } from "papaparse";
import timetableCsv from "./assets/TimeTable_18_10_2025.csv?raw";
import { useCallback, useEffect, useMemo, useState } from "react";

type CsvRow = Record<string, string>;
type RawSession = {
  title: string;
  description: string;
  start: Date;
  end: Date;
};

type PracticeSession = RawSession & {
  id: string;
  pairCount: number;
  occurrence: number;
};

type UpcomingSessionProps = {
  session: PracticeSession;
  onToggle: (id: string) => void;
  completed: boolean;
};

const STORAGE_KEY = "practice-sessions-completed";
const MAX_GAP_MINUTES = 20;

const normalizeString = (value: string | undefined): string =>
  (value ?? "").trim();

const PREWORK_TITLES = new Set(
  [
    "ПScala Пз DL ІТШІ-22-4",
    "ПNET Пз DL ІТШІ-22-4",
    "ІТвІSW Пз DL ІТШІ-22-4",
  ].map((title) => normalizeString(title).toLocaleLowerCase())
);

const parseDateTime = (
  date: string | undefined,
  time: string | undefined
): Date | null => {
  const safeDate = normalizeString(date);
  const safeTime = normalizeString(time);

  if (!safeDate || !safeTime) {
    return null;
  }

  const [day, month, year] = safeDate
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  const [hours, minutes, seconds] = safeTime
    .split(":")
    .map((part) => Number.parseInt(part, 10));

  if (
    [day, month, year].some(Number.isNaN) ||
    [hours, minutes, seconds].some(Number.isNaN)
  ) {
    return null;
  }

  return new Date(year, month - 1, day, hours ?? 0, minutes ?? 0, seconds ?? 0);
};

const detectIsPractice = (row: CsvRow): boolean => {
  const topic = normalizeString(row["Тема"]);
  const description = normalizeString(row["Описание"]);

  const ignorePatterns = [
    /фв\s*пз\s*dl\s*ітші-22-1,2,3,4/i,
    /\*матр\s*пз\s*dl\s*\*матр\(ітші-22-\)-1/i,
  ];

  if (
    ignorePatterns.some(
      (pattern) => pattern.test(topic) || pattern.test(description)
    )
  ) {
    return false;
  }

  const hasPracticeMarker = /пз/i.test(topic) || /пз/i.test(description);
  const hasLectureMarker = /лк/i.test(topic) || /лк/i.test(description);

  return hasPracticeMarker && !hasLectureMarker;
};

const mergePracticeSessions = (
  sessions: RawSession[]
): Array<RawSession & { pairCount: number }> => {
  return sessions.reduce<Array<RawSession & { pairCount: number }>>(
    (accumulator, current) => {
      const previous = accumulator[accumulator.length - 1];

      if (
        previous &&
        previous.title === current.title &&
        isSameDay(previous.start, current.start) &&
        current.start.getTime() - previous.end.getTime() <=
          MAX_GAP_MINUTES * 60 * 1000
      ) {
        accumulator[accumulator.length - 1] = {
          ...previous,
          end:
            current.end.getTime() > previous.end.getTime()
              ? current.end
              : previous.end,
          pairCount: previous.pairCount + 1,
        };
        return accumulator;
      }

      accumulator.push({ ...current, pairCount: 1 });
      return accumulator;
    },
    []
  );
};

const parseCsv = (csv: string): PracticeSession[] => {
  const parsed: ParseResult<CsvRow> = Papa.parse<CsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string): string => header.trim(),
  });

  const rawSessions = parsed.data
    .filter((row: CsvRow) => detectIsPractice(row))
    .map((row: CsvRow) => {
      const title = normalizeString(row["Тема"]) || "Практика";
      const description = normalizeString(row["Описание"]) || title;
      const start = parseDateTime(row["Дата начала"], row["Время начала"]);

      if (!start) {
        return null;
      }

      const end =
        parseDateTime(row["Дата завершения"], row["Время завершения"]) ?? start;

      return {
        title,
        description,
        start,
        end,
      };
    })
    .filter((session): session is RawSession => session !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const mergedSessions = mergePracticeSessions(rawSessions);
  const counters = new Map<string, number>();

  return mergedSessions.map((session) => {
    const nextCount = (counters.get(session.title) ?? 0) + 1;
    counters.set(session.title, nextCount);

    return {
      ...session,
      id: `${session.title}::${session.start.toISOString()}`,
      occurrence: nextCount,
    };
  });
};

const loadCompletedSessions = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed.filter((item): item is string => typeof item === "string")
      );
    }
    return new Set();
  } catch {
    return new Set();
  }
};

function App() {
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() =>
    loadCompletedSessions()
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(completedIds)));
  }, [completedIds]);

  useEffect(() => {
    try {
      const parsedSessions = parseCsv(timetableCsv);
      if (!parsedSessions.length) {
        setError("В расписании не найдено практических занятий.");
        setSessions([]);
      } else {
        setSessions(parsedSessions);
        setError(null);
      }
    } catch (parseError) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : "Не удалось разобрать CSV.";
      setError(message);
      setSessions([]);
    }
  }, []);

  const toggleCompleted = useCallback((sessionID: string) => {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionID)) {
        next.delete(sessionID);
      } else {
        next.add(sessionID);
      }
      return next;
    });
  }, []);

  const {
    combinedSessions,
    missedSessionsIds,
    completedSessionsIds,
    preworkSessionsIds,
  } = useMemo(() => {
    const nowTs = Date.now();
    const missed: PracticeSession[] = [];
    const completed: PracticeSession[] = [];
    const upcoming: PracticeSession[] = [];
    const preworkMatches = new Set<string>();

    sessions.forEach((session) => {
      const normalizedTitle = normalizeString(
        session.title
      ).toLocaleLowerCase();
      if (PREWORK_TITLES.has(normalizedTitle)) {
        preworkMatches.add(session.id);
      }

      if (completedIds.has(session.id)) {
        completed.push(session);
        return;
      }

      if (session.start.getTime() <= nowTs) {
        missed.push(session);
      } else {
        upcoming.push(session);
      }
    });

    missed.sort((a, b) => a.start.getTime() - b.start.getTime());
    upcoming.sort((a, b) => a.start.getTime() - b.start.getTime());

    return {
      missedSessions: missed,
      upcomingSessions: upcoming,
      combinedSessions: [...missed, ...upcoming],
      missedSessionsIds: new Set(missed.map((item) => item.id)),
      completedSessionsIds: new Set(completed.map((item) => item.id)),
      preworkSessionsIds: preworkMatches,
    };
  }, [sessions, completedIds]);

  const nextThree = combinedSessions.slice(0, 3);

  const UpcomingSession: React.FC<UpcomingSessionProps> = ({
    session,
    onToggle,
    completed,
  }) => (
    <li>
      <button
        type="button"
        role="chekbox"
        aria-pressed={completed}
        onClick={() => onToggle(session.id)}
        className={`session-upcoming-card card ${
          missedSessionsIds.has(session.id)
            ? "card-missed"
            : completedSessionsIds.has(session.id)
            ? "card-completed"
            : ""
        } ${
          preworkSessionsIds.has(session.id)
            ? "card-prework card-upcoming-prework"
            : ""
        }`}
      >
        <h3 className={`session-card-title session-upcoming-card-title `}>
          {session.title}
        </h3>
        <p className="session-order session-upcoming-card-order ">
          Практика №{session.occurrence} по предмету
        </p>
        <p className="session-time">
          {format(session.start, "dd.MM.yyyy HH:mm")} —{" "}
          {format(session.end, "HH:mm")}
        </p>
      </button>
    </li>
  );

  const AllSessions: React.FC<UpcomingSessionProps> = ({
    session,
    onToggle,
    completed,
  }) => (
    <li>
      <button
        type="button"
        role="chekbox"
        aria-pressed={completed}
        onClick={() => onToggle(session.id)}
        className={`session-card card ${
          missedSessionsIds.has(session.id)
            ? "card-missed"
            : completedSessionsIds.has(session.id)
            ? "card-completed"
            : ""
        } ${preworkSessionsIds.has(session.id) ? "card-prework" : ""}`}
      >
        <h3 className={`session-card-title`}>{session.title}</h3>
        <p className="session-order">
          Практика №{session.occurrence} по предмету
        </p>
        <p className="session-time">
          {format(session.start, "dd.MM.yyyy HH:mm")} —{" "}
          {format(session.end, "HH:mm")}
        </p>
      </button>
    </li>
  );

  return (
    <main className="app">
      {error ? (
        <p>{error}</p>
      ) : (
        <>
          <section>
            <ul className="session-grid">
              {nextThree.map((session) => (
                <UpcomingSession
                  key={session.id}
                  session={session}
                  completed={completedIds.has(session.id)}
                  onToggle={toggleCompleted}
                />
              ))}
            </ul>
          </section>
          <section>
            <ul className="session-list">
              {sessions.map((session) => (
                <AllSessions
                  key={session.id}
                  session={session}
                  completed={completedIds.has(session.id)}
                  onToggle={toggleCompleted}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
