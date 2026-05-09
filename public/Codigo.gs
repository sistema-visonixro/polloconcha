/**
 * Web App: recibe ?cierre_id=123
 * Consulta Supabase y envía correo de cierre al admin.
 *
 * CAMBIOS EN ESTA VERSIÓN (Corrección de Timezone):
 * - Ahora acepta parámetros adicionales: total_ventas, fecha_apertura, fecha_cierre, caja, cajero_id
 * - Usa total_ventas del frontend si viene (máxima precisión)
 * - Fuerza Honduras timezone (-06:00) en TODAS las conversiones de fecha/hora
 * - Función toTsHonduras_() reemplaza toTs_() para garantizar consistencia
 * - Los filtros de fechas en Supabase ahora incluyen zona horaria explícita
 *
 * CONFIGURACIÓN (Script Properties):
 * - SUPABASE_URL            -> https://TU-PROYECTO.supabase.co
 * - SUPABASE_SERVICE_KEY    -> service_role key (NO anon key)
 * - ADMIN_EMAIL_FALLBACK    -> correo fallback si no encuentra admin en DB
 * - TZ                      -> America/Tegucigalpa (opcional)
 */

function doGet(e) {
  return procesarSolicitud_(e);
}

function doPost(e) {
  return procesarSolicitud_(e);
}

function procesarSolicitud_(e) {
  try {
    const cierreIdRaw =
      (e && e.parameter && (e.parameter.cierre_id || e.parameter.id)) || "";
    const cierreId = String(cierreIdRaw).trim();

    // Parámetros adicionales enviados por el frontend (opcionalmente)
    const totalVentasParam =
      (e && e.parameter && e.parameter.total_ventas) || "";
    const fechaAperturaParam =
      (e && e.parameter && e.parameter.fecha_apertura) || "";
    const fechaCierreParam =
      (e && e.parameter && e.parameter.fecha_cierre) || "";
    const caja_param = (e && e.parameter && e.parameter.caja) || "";
    const cajeroid_param = (e && e.parameter && e.parameter.cajero_id) || "";

    if (!cierreId) {
      return jsonResponse_(400, {
        ok: false,
        error: "Falta parámetro cierre_id",
      });
    }

    const props = PropertiesService.getScriptProperties();
    const SUPABASE_URL = mustProp_(props, "SUPABASE_URL").replace(/\/+$/, "");
    const SUPABASE_SERVICE_KEY = mustProp_(props, "SUPABASE_SERVICE_KEY");
    const ADMIN_EMAIL_FALLBACK =
      props.getProperty("ADMIN_EMAIL_FALLBACK") || "";
    const TZ = props.getProperty("TZ") || "America/Tegucigalpa";

    // 1) Obtener cierre
    const cierre = getSingle_({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_SERVICE_KEY,
      table: "cierres",
      select:
        "id,cajero,cajero_id,caja,fecha,fecha_apertura,fecha_cierre,fondo_fijo,fondo_fijo_registrado,efectivo_dia,efectivo_registrado,monto_tarjeta_dia,monto_tarjeta_registrado,transferencias_dia,transferencias_registradas,dolares_dia,dolares_registrado,diferencia,observacion,estado",
      filters: ["id=eq." + encodeURIComponent(cierreId)],
    });

    if (!cierre) {
      return jsonResponse_(404, {
        ok: false,
        error: "No existe cierre con ese id",
      });
    }

    // Usar parámetros enviados del frontend si vienen; si no, usar del cierre
    const fechaInicio =
      fechaAperturaParam || cierre.fecha_apertura || cierre.fecha;
    const fechaFin = fechaCierreParam || cierre.fecha_cierre || cierre.fecha;
    if (!fechaInicio || !fechaFin) {
      return jsonResponse_(422, {
        ok: false,
        error: "El cierre no tiene rango de fechas válido",
      });
    }

    // 2) Si se envió total_ventas desde frontend, usarlo directamente (máxima precisión)
    let totalVentasDia = toNum_(totalVentasParam);
    let platillosDia = 0;
    let bebidasDia = 0;
    let ventasNormales = [];

    if (totalVentasDia > 0) {
      // Frontend ya calculó el total; confiar en ese valor
      Logger.log("Usando total_ventas del frontend: " + totalVentasDia);
    } else {
      // Fallback: recalcular desde DB (menor precisión, pero backwards compatible)
      const ventas = getMany_({
        baseUrl: SUPABASE_URL,
        key: SUPABASE_SERVICE_KEY,
        table: "ventas",
        select: "fecha_hora,tipo,es_donacion,productos,total",
        filters: [
          "cajero_id=eq." + encodeURIComponent(String(cierre.cajero_id || "")),
          "caja=eq." + encodeURIComponent(String(cierre.caja || "")),
          "fecha_hora=gte." +
            encodeURIComponent(parseHondurasDatetimeForFilter_(fechaInicio)),
          "fecha_hora=lte." +
            encodeURIComponent(parseHondurasDatetimeForFilter_(fechaFin)),
          "tipo=neq.CREDITO",
        ],
      });

      ventasNormales = (ventas || []).filter(function (v) {
        return v.es_donacion !== true;
      });

      totalVentasDia = sumField_(ventasNormales, "total");
      platillosDia = contarTipo_(ventasNormales, "comida");
      bebidasDia = contarTipo_(ventasNormales, "bebida");
    }

    // 3) Obtener gastos del turno
    const gastos = getMany_({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_SERVICE_KEY,
      table: "gastos",
      select: "monto,fecha,fecha_hora,caja,cajero_id",
      filters: [
        "cajero_id=eq." + encodeURIComponent(String(cierre.cajero_id || "")),
        "caja=eq." + encodeURIComponent(String(cierre.caja || "")),
      ],
    });

    const tsInicio = toTsHonduras_(fechaInicio);
    const tsFin = toTsHonduras_(fechaFin);
    const gastosTurno = (gastos || []).filter(function (g) {
      const ts = toTsHonduras_(
        g.fecha_hora || (g.fecha ? g.fecha + "T00:00:00" : ""),
      );
      return ts >= tsInicio && ts <= tsFin;
    });

    const gastosDia = (gastosTurno || []).reduce(function (acc, g) {
      return acc + toNum_(g.monto);
    }, 0);

    // 4) Precio dólar
    const precioDolarRow = getSingle_({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_SERVICE_KEY,
      table: "precio_dolar",
      select: "valor",
      filters: ["id=eq.singleton"],
    });
    const precioDolar = toNum_(precioDolarRow && precioDolarRow.valor);

    // 5) Correo admin
    let adminEmail = "";
    const adminUser = getSingle_({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_SERVICE_KEY,
      table: "usuarios",
      select: "email",
      filters: ["rol=eq.Admin"],
    });
    if (adminUser && adminUser.email)
      adminEmail = String(adminUser.email).trim();
    if (!adminEmail) adminEmail = String(ADMIN_EMAIL_FALLBACK || "").trim();

    if (!adminEmail) {
      return jsonResponse_(422, {
        ok: false,
        error:
          "No se encontró correo de admin en Supabase y tampoco ADMIN_EMAIL_FALLBACK",
      });
    }

    // 6) Armar correo
    const diff = toNum_(cierre.diferencia);
    const difSign = diff > 0 ? "A FAVOR" : diff < 0 ? "EN CONTRA" : "CUADRADO";
    const difAbs = Math.abs(diff);

    const subject =
      "Cierre de Caja #" + cierre.id + " - " + (cierre.caja || "Caja");
    const html = buildHtml_({
      cierre: cierre,
      gastosDia: gastosDia,
      platillosDia: platillosDia,
      bebidasDia: bebidasDia,
      totalVentasDia: totalVentasDia,
      precioDolar: precioDolar,
      difSign: difSign,
      difAbs: difAbs,
      tz: TZ,
    });

    const plain =
      "Cierre #" +
      cierre.id +
      "\n" +
      "Cajero: " +
      (cierre.cajero || "") +
      "\n" +
      "Caja: " +
      (cierre.caja || "") +
      "\n" +
      "Venta del día: L " +
      fmt2_(totalVentasDia) +
      "\n" +
      "Diferencia: L " +
      fmt2_(difAbs) +
      " (" +
      difSign +
      ")";

    GmailApp.sendEmail(adminEmail, subject, plain, { htmlBody: html });

    return jsonResponse_(200, {
      ok: true,
      cierre_id: cierre.id,
      email: adminEmail,
      mensaje: "Correo enviado correctamente",
    });
  } catch (err) {
    return jsonResponse_(500, {
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
}

/* ===================== Helpers ===================== */

function buildHtml_(ctx) {
  const c = ctx.cierre;
  const colorDif =
    toNum_(c.diferencia) > 0
      ? "#166534"
      : toNum_(c.diferencia) < 0
        ? "#b91c1c"
        : "#0f172a";

  return (
    "<div style='font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#111'>" +
    "<h2 style='margin:0 0 10px'>REPORTE DE CIERRE DE CAJA</h2>" +
    "<p style='margin:0 0 16px;color:#475569'>Cierre #" +
    esc_(c.id) +
    "</p>" +
    "<h3 style='margin:14px 0 8px'>Información general</h3>" +
    row_("Cajero", c.cajero) +
    row_("Caja", c.caja) +
    row_("Apertura", fmtFecha_(c.fecha_apertura || c.fecha, ctx.tz)) +
    row_("Cierre", fmtFecha_(c.fecha_cierre || c.fecha, ctx.tz)) +
    "<h3 style='margin:16px 0 8px'>Resumen de ventas</h3>" +
    row_("Platillos", Math.round(toNum_(ctx.platillosDia))) +
    row_("Bebidas", Math.round(toNum_(ctx.bebidasDia))) +
    "<h3 style='margin:16px 0 8px'>Sistema</h3>" +
    row_("Fondo fijo", "L " + fmt2_(c.fondo_fijo)) +
    row_("Efectivo (neto)", "L " + fmt2_(c.efectivo_dia)) +
    row_("Tarjeta", "L " + fmt2_(c.monto_tarjeta_dia)) +
    row_("Transferencia", "L " + fmt2_(c.transferencias_dia)) +
    row_("Dólares (USD)", "$ " + fmt2_(c.dolares_dia)) +
    row_("Precio dólar", "L " + fmt2_(ctx.precioDolar)) +
    row_("Gastos", "L " + fmt2_(ctx.gastosDia)) +
    "<h3 style='margin:16px 0 8px'>Venta del día</h3>" +
    rowStrong_("Total", "L " + fmt2_(ctx.totalVentasDia)) +
    "<h3 style='margin:16px 0 8px'>Conteo cajero</h3>" +
    row_("Fondo fijo", "L " + fmt2_(c.fondo_fijo_registrado)) +
    row_("Efectivo", "L " + fmt2_(c.efectivo_registrado)) +
    row_("Tarjeta", "L " + fmt2_(c.monto_tarjeta_registrado)) +
    row_("Transferencia", "L " + fmt2_(c.transferencias_registradas)) +
    row_("Dólares (USD)", "$ " + fmt2_(c.dolares_registrado)) +
    "<h3 style='margin:16px 0 8px'>Diferencia</h3>" +
    "<div style='padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px'>" +
    "<div style='display:flex;justify-content:space-between;font-weight:700'>" +
    "<span>Monto</span><span>L " +
    fmt2_(ctx.difAbs) +
    "</span>" +
    "</div>" +
    "<div style='margin-top:6px;color:" +
    colorDif +
    ";font-weight:700'>" +
    esc_(ctx.difSign) +
    "</div>" +
    "</div>" +
    "<p style='margin-top:16px;color:#64748b;font-size:12px'>Observación: " +
    esc_(c.observacion || "") +
    "</p>" +
    "</div>"
  );
}

function row_(k, v) {
  return (
    "<div style='display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0'><span>" +
    esc_(k) +
    "</span><span>" +
    esc_(v == null ? "" : v) +
    "</span></div>"
  );
}

function rowStrong_(k, v) {
  return (
    "<div style='display:flex;justify-content:space-between;padding:6px 0;font-weight:700'><span>" +
    esc_(k) +
    "</span><span>" +
    esc_(v == null ? "" : v) +
    "</span></div>"
  );
}

function getSingle_(opts) {
  const rows = getMany_(opts);
  return rows && rows.length ? rows[0] : null;
}

function getMany_(opts) {
  const url = buildRestUrl_(
    opts.baseUrl,
    opts.table,
    opts.select,
    opts.filters,
  );
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      apikey: opts.key,
      Authorization: "Bearer " + opts.key,
    },
  });

  const code = res.getResponseCode();
  const body = res.getContentText() || "[]";
  if (code < 200 || code >= 300) {
    throw new Error("Supabase error [" + code + "]: " + body);
  }
  return JSON.parse(body);
}

function buildRestUrl_(baseUrl, table, select, filters) {
  const parts = [];
  parts.push(
    baseUrl +
      "/rest/v1/" +
      encodeURIComponent(table) +
      "?select=" +
      encodeURIComponent(select || "*"),
  );
  (filters || []).forEach(function (f) {
    parts.push("&" + f);
  });
  parts.push("&order=id.desc&limit=1");
  return parts.join("");
}

function contarTipo_(ventas, tipoBuscado) {
  let count = 0;
  (ventas || []).forEach(function (venta) {
    const factor =
      String(venta.tipo || "").toUpperCase() === "DEVOLUCION" ? -1 : 1;
    let productos = venta.productos;
    if (typeof productos === "string") {
      try {
        productos = JSON.parse(productos);
      } catch (_) {
        productos = [];
      }
    }
    if (!Array.isArray(productos)) productos = [];
    productos.forEach(function (p) {
      const tipo = String((p && p.tipo) || "").toLowerCase();
      if (tipo === String(tipoBuscado).toLowerCase()) {
        count += factor * parseInt((p && (p.cantidad || p.qty || 1)) || 1, 10);
      }
    });
  });
  return count;
}

function sumField_(arr, field) {
  return (arr || []).reduce(function (acc, x) {
    return acc + toNum_(x && x[field]);
  }, 0);
}

function toNum_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Convierte un datetime string a timestamp forzando Honduras timezone (UTC-6)
 * "2026-05-09" → "2026-05-09T00:00:00-06:00"
 * "2026-05-09 15:30:00" → "2026-05-09T15:30:00-06:00"
 */
function toTsHonduras_(datetimeStr) {
  if (!datetimeStr) return 0;

  const str = String(datetimeStr).trim();

  // Si ya tiene formato ISO con zona (+HH:MM o Z), parsear directamente
  if (/Z$|[+\-]\d{2}:\d{2}$/.test(str)) {
    const d = new Date(str);
    const t = d.getTime();
    return isFinite(t) ? t : 0;
  }

  // Si es formato local (sin zona), convertir a ISO con -06:00 (Honduras)
  const normalized = str.includes("T") ? str : str.replace(" ", "T");
  const isoWithZone = normalized + "-06:00";

  const d = new Date(isoWithZone);
  const t = d.getTime();
  return isFinite(t) ? t : 0;
}

/**
 * Prepara un datetime string para filtros Supabase con Honduras timezone
 */
function parseHondurasDatetimeForFilter_(datetimeStr) {
  if (!datetimeStr) return "";

  const str = String(datetimeStr).trim();

  // Si ya tiene zona, devolverlo como está
  if (/Z$|[+\-]\d{2}:\d{2}$/.test(str)) {
    return str;
  }

  // Si es local, convertir a ISO con Honduras -06:00
  const normalized = str.includes("T") ? str : str.replace(" ", "T");
  return normalized + "-06:00";
}

function fmt2_(n) {
  return toNum_(n).toFixed(2);
}

function fmtFecha_(iso, tz) {
  if (!iso) return "—";
  try {
    return Utilities.formatDate(
      new Date(iso),
      tz || "America/Tegucigalpa",
      "dd/MM/yyyy HH:mm:ss",
    );
  } catch (_) {
    return String(iso);
  }
}

function esc_(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mustProp_(props, key) {
  const val = props.getProperty(key);
  if (!val) throw new Error("Falta Script Property: " + key);
  return val;
}

function jsonResponse_(status, obj) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: status, ...obj }),
  ).setMimeType(ContentService.MimeType.JSON);
}
