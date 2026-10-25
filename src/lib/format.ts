// Formatting for timestamps recorded by the system (not reporter-entered partial dates).
export const APP_TIME_ZONE = "Asia/Kolkata";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: APP_TIME_ZONE,
});

const dateOnly = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: APP_TIME_ZONE,
});

const timeOnly = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: APP_TIME_ZONE,
});

export function formatDate(value: Date | null | undefined): string {
  return value ? dateOnly.format(value) : "";
}

export function formatTime(value: Date | null | undefined): string {
  return value ? timeOnly.format(value) : "";
}

export function formatDateTime(value: Date | null | undefined): string {
  return value ? dateTime.format(value) : "";
}

/** Elapsed time in words, e.g. "45 min", "3 h", "2 d 4 h". */
export function formatElapsed(from: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

const isoDate = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE });

/** Today's date in the institution's time zone, as "YYYY-MM-DD". */
export function todayInAppZone(now: Date = new Date()): string {
  return isoDate.format(now);
}

const localInput = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: APP_TIME_ZONE,
});

/** The current time in the institution's time zone, as a datetime-local value "YYYY-MM-DDTHH:mm". */
export function nowAsLocalInput(now: Date = new Date()): string {
  const p = Object.fromEntries(localInput.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
