// Helper para obtener el inicio y fin del día en ISO (UTC) basados en la fecha local
export function getLocalDayRange(date?: Date) {
  const d = date ? new Date(date) : new Date();
  // inicio de día en hora local
  const startLocal = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  // fin de día en hora local
  const endLocal = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Formato local sin conversión a UTC: 'YYYY-MM-DD HH:MM:SS'
  const startLocalString = `${day} 00:00:00`;
  const endLocalString = `${day} 23:59:59`;

  return {
    // start/end usados por consultas en Supabase (cadena en zona local)
    start: startLocalString,
    end: endLocalString,
    // ISO por compatibilidad si se necesita
    startIso: startLocal.toISOString(),
    endIso: endLocal.toISOString(),
    day,
  };
}

// Formatea una fecha en la zona de Honduras (America/Tegucigalpa)
// y devuelve 'YYYY-MM-DD HH:MM:SS' (hora local de Honduras).
export function formatToHondurasLocal(date?: Date) {
  const d = date ? new Date(date) : new Date();
  const fmt = new Intl.DateTimeFormat('sv', {
    timeZone: 'America/Tegucigalpa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce((acc: any, p: any) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  // parts: { year, month, day, hour, minute, second }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseLocalDateTime(value: unknown): number {
  if (typeof value !== "string") return 0;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();
}

function parseNumericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function compareTurnoRecordsByRecency(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const idA = parseNumericId(a.id);
  const idB = parseNumericId(b.id);
  const pendingA = a.pending_sync === true || (idA !== null && idA < 0);
  const pendingB = b.pending_sync === true || (idB !== null && idB < 0);

  if (pendingA !== pendingB) return pendingA ? -1 : 1;

  const bothPositiveIds =
    idA !== null && idB !== null && idA > 0 && idB > 0 && idA !== idB;
  if (bothPositiveIds) return idB - idA;

  const bothNegativeIds =
    idA !== null && idB !== null && idA < 0 && idB < 0 && idA !== idB;
  if (bothNegativeIds) return Math.abs(idB) - Math.abs(idA);

  const stampA = Math.max(
    typeof a.timestamp === "number" ? a.timestamp : 0,
    typeof a.guardadoEn === "number" ? a.guardadoEn : 0,
  );
  const stampB = Math.max(
    typeof b.timestamp === "number" ? b.timestamp : 0,
    typeof b.guardadoEn === "number" ? b.guardadoEn : 0,
  );
  if (stampA !== stampB) return stampB - stampA;

  const fechaA = parseLocalDateTime(a.fecha);
  const fechaB = parseLocalDateTime(b.fecha);
  if (fechaA !== fechaB) return fechaB - fechaA;

  if (idA !== null && idB !== null && idA !== idB) {
    return idB - idA;
  }

  return 0;
}
