import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getLocalDayRange } from "./utils/fechas";

export default function CierresAdminView({
  onVolver,
}: {
  onVolver?: () => void;
}) {
  const obtenerFechaLocalYMD = (value: any): string => {
    if (!value) return "";
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const normalizarFechaComparable = (value: any): string => {
    if (!value) return "";
    const raw = String(value).trim();
    const isoRaw = raw.replace(" ", "T");
    const date = new Date(isoRaw);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
    return raw;
  };

  const aperturaTieneCierre = (ap: any, rows: any[]): boolean => {
    if (ap?.estado === "CIERRE" || ap?.tipo_registro === "cierre") {
      return true;
    }

    // Compatibilidad con registros antiguos donde el cierre pudo quedar en una fila aparte.
    // En ese caso el cierre heredaba la misma fecha exacta de la apertura original.
    const fechaApertura = normalizarFechaComparable(ap?.fecha);
    return rows.some(
      (ci) =>
        ci?.id !== ap?.id &&
        (ci?.estado === "CIERRE" || ci?.tipo_registro === "cierre") &&
        ci?.caja === ap?.caja &&
        ci?.cajero === ap?.cajero &&
        normalizarFechaComparable(ci?.fecha) === fechaApertura,
    );
  };

  const [fechaDesde, setFechaDesde] = useState(() => {
    const { day } = getLocalDayRange();
    return day;
  });
  const [fechaHasta, setFechaHasta] = useState(() => {
    const { day } = getLocalDayRange();
    return day;
  });
  const [cierres, setCierres] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtroId, setFiltroId] = useState<number | null>(null);
  // Clave de aclaración eliminada del UI
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [cajaCierre, setCajaCierre] = useState<any>(null);
  const [cerrandoCaja, setCerrandoCaja] = useState(false);
  const [cierreError, setCierreError] = useState("");
  const [valoresCierre, setValoresCierre] = useState<any | null>(null);

  useEffect(() => {
    cargarCierres();
  }, [fechaDesde, fechaHasta]);

  const cargarCierres = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("cierres").select("*");
      if (!error) {
        const rows = data || [];
        const filtrados = rows.filter((row: any) => {
          const fecha = obtenerFechaLocalYMD(
            row?.fecha_apertura || row?.fecha || row?.fecha_cierre,
          );
          if (!fecha) return false;
          if (fechaDesde && fecha < fechaDesde) return false;
          if (fechaHasta && fecha > fechaHasta) return false;
          return true;
        });
        setCierres(filtrados);
      }
    } catch (error) {
      console.error("Error loading cierres:", error);
    } finally {
      setLoading(false);
    }
  };

  // función de clave eliminada porque ya no se muestra el botón

  // Implementaciones mínimas para handlers removidos anteriormente
  const handleVerCaja = (ap: any) => {
    setFiltroId(ap?.id ?? null);
  };

  const handleAbrirCierre = (ap: any) => {
    if (aperturaTieneCierre(ap, cierres)) {
      alert("Esta caja ya está cerrada para esa fecha.");
      return;
    }

    setCajaCierre(ap);
    setValoresCierre({
      fondoFijoRegistrado: 0,
      fondoFijoDia: 0,
      efectivoRegistrado: 0,
      efectivoDia: 0,
      montoTarjetaRegistrado: 0,
      tarjetaDia: 0,
      transferenciasRegistradas: 0,
      transferenciasDia: 0,
      diferencia: 0,
      observacion: "sin aclarar",
    });
    setShowCierreModal(true);
  };

  // funciones relacionadas con clave eliminadas (removidas)

  let cierresFiltrados: any[] = cierres;
  if (filtroId !== null) {
    cierresFiltrados = cierres.filter((c: any) => c.id === filtroId);
  }

  const aperturasFiltradas = cierres.filter(
    (c) =>
      c.tipo_registro === "apertura" &&
      (fechaDesde
        ? obtenerFechaLocalYMD(c.fecha_apertura || c.fecha) >= fechaDesde
        : true) &&
      (fechaHasta
        ? obtenerFechaLocalYMD(c.fecha_apertura || c.fecha) <= fechaHasta
        : true),
  );

  const cajasAbiertasList = aperturasFiltradas.filter((ap) => {
    return !aperturaTieneCierre(ap, cierres);
  });
  const cajasAbiertas = cajasAbiertasList.length;

  // Recalcular diferencias como (lo registrado - lo del día) por cada cierre sin aclarar
  const cierresSinAclarar = cierres.filter(
    (c) => c.tipo_registro === "cierre" && c.observacion === "sin aclarar",
  );

  // Para cada cierre calculamos la diferencia por tipo usando los campos registrados y los del día
  const diferenciaPorCierre = cierresSinAclarar.map((c) => {
    const fondo_reg = Number(c.fondo_fijo_registrado || 0);
    const fondo_dia = Number(c.fondo_fijo || 0);
    const efectivo_reg = Number(c.efectivo_registrado || 0);
    const efectivo_dia = Number(c.efectivo_dia || 0);
    const tarjeta_reg = Number(c.monto_tarjeta_registrado || 0);
    const tarjeta_dia = Number(c.monto_tarjeta_dia || 0);
    const trans_reg = Number(c.transferencias_registradas || 0);
    const trans_dia = Number(c.transferencias_dia || 0);
    return {
      total:
        fondo_reg -
        fondo_dia +
        (efectivo_reg - efectivo_dia) +
        (tarjeta_reg - tarjeta_dia) +
        (trans_reg - trans_dia),
      efectivo: efectivo_reg - efectivo_dia,
      tarjeta: tarjeta_reg - tarjeta_dia,
      transferencias: trans_reg - trans_dia,
    };
  });

  const sumaDiferencia = diferenciaPorCierre.reduce(
    (sum, d) => sum + d.total,
    0,
  );
  const sumaEfectivoSinAclarar = diferenciaPorCierre.reduce(
    (sum, d) => sum + d.efectivo,
    0,
  );
  const sumaTarjetaSinAclarar = diferenciaPorCierre.reduce(
    (sum, d) => sum + d.tarjeta,
    0,
  );
  const sumaTransferenciasSinAclarar = diferenciaPorCierre.reduce(
    (sum, d) => sum + d.transferencias,
    0,
  );

  const handleCerrarCaja = async () => {
    if (!cajaCierre || !valoresCierre) return;

    setCerrandoCaja(true);
    setCierreError("");

    try {
      // UPDATE: cambiar la misma fila a cierre
      const updates = {
        estado: "CIERRE",
        tipo_registro: "cierre",
        fondo_fijo_registrado: valoresCierre.fondoFijoRegistrado,
        fondo_fijo: valoresCierre.fondoFijoDia,
        efectivo_registrado: valoresCierre.efectivoRegistrado,
        efectivo_dia: valoresCierre.efectivoDia,
        monto_tarjeta_registrado: valoresCierre.montoTarjetaRegistrado,
        monto_tarjeta_dia: valoresCierre.tarjetaDia,
        transferencias_registradas: valoresCierre.transferenciasRegistradas,
        transferencias_dia: valoresCierre.transferenciasDia,
        diferencia: valoresCierre.diferencia,
        observacion: valoresCierre.observacion,
        fecha_cierre: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("cierres")
        .update(updates)
        .eq("id", cajaCierre.id);
      if (error) {
        setCierreError("Error al registrar el cierre: " + error.message);
      } else {
        setShowCierreModal(false);
        setCajaCierre(null);
        setValoresCierre(null);
        await cargarCierres();
      }
    } catch (error) {
      setCierreError("Error de conexión");
    } finally {
      setCerrandoCaja(false);
    }
  };

  const handleAclararCierre = async (cierreId: number) => {
    try {
      const { error } = await supabase
        .from("cierres")
        .update({ observacion: "aclarado" })
        .eq("id", cierreId);
      if (!error) {
        await cargarCierres();
      }
    } catch (error) {
      console.error("Error aclarando cierre:", error);
    }
  };

  const handleReaperturarCaja = async (row: any) => {
    const ok = window.confirm(
      `¿Reaperturar caja ${row?.caja || ""} para ${row?.cajero || ""}?`,
    );
    if (!ok) return;
    try {
      // UPDATE: cambiar la misma fila a apertura
      const { error } = await supabase
        .from("cierres")
        .update({
          estado: "APERTURA",
          tipo_registro: "apertura",
          fecha_cierre: null,
        })
        .eq("id", row.id);
      if (!error) {
        await cargarCierres();
      }
    } catch (error) {
      console.error("Error reaperturando caja:", error);
    }
  };

  return (
    <div
      className="cierres-enterprise"
      style={{
        width: "100vw",
        height: "100vh",
        minHeight: "100vh",
        minWidth: "100vw",
        margin: 0,
        padding: 0,
        boxSizing: "border-box",
        overflow: "auto",
      }}
    >
      <style>{`
        body, #root {
          width: 100vw !important;
          height: 100vh !important;
          min-width: 100vw !important;
          min-height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box !important;
          display: block !important;
          max-width: none !important;
          background: unset !important;
        }
        :root {
          --primary: #ffffff;
          --secondary: #f8fafc;
          --accent: #3b82f6;
          --text-primary: #0f172a;
          --text-secondary: #64748b;
          --border: #e2e8f0;
          --shadow: 0 4px 20px rgba(0,0,0,0.06);
          --shadow-hover: 0 12px 32px rgba(0,0,0,0.12);
          --success: #10b981;
          --danger: #ef4444;
          --warning: #f59e0b;
          --info: #3b82f6;
        }

        .cierres-enterprise {
          min-height: 100vh;
          background: #f0f4f8;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 1.25rem;
          color: var(--text-primary);
        }

        .container {
          max-width: 1460px;
          margin: 0 auto;
          color: var(--text-primary);
        }

        .header {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 1.5rem 2rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          flex-wrap: wrap;
          gap: 1rem;
          color: var(--text-primary);
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
          color: var(--text-primary);
        }

        .btn-back {
          background: #f1f5f9;
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .page-title {
          color: var(--text-primary);
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0;
        }

        .header-controls {
          display: flex;
          align-items: center;
          gap: 1rem;
          color: var(--text-primary);
        }

        .date-input {
          background: #f8fafc;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 12px;
          color: var(--text-primary);
          font-size: 1rem;
        }

        .btn-primary {
          background: linear-gradient(135deg, var(--info), #42a5f5);
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 10px 20px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-secondary {
          background: #f1f5f9;
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 20px;
          font-weight: 600;
          cursor: pointer;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
          color: var(--text-primary);
        }

        .stat-card {
          background: white;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 1.5rem;
          transition: all 0.3s ease;
          color: var(--text-primary);
          box-shadow: var(--shadow);
        }

        .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: var(--shadow-hover);
        }

        .stat-icon { 
          font-size: 2rem; 
          margin-bottom: 0.5rem; 
        }

        .stat-title { 
          color: var(--text-secondary);
          font-size: 0.875rem;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .stat-value { 
          font-size: 2rem; 
          font-weight: 800; 
          margin-bottom: 1rem;
        }

        .open-card { 
          border-left: 4px solid var(--success); 
        }

        .open-card .stat-icon { color: var(--success); }
        .open-card .stat-value { color: var(--success); }

        .alert-card { 
          border-left: 4px solid var(--warning); 
        }

        .alert-card .stat-icon { color: var(--warning); }
        .alert-card .stat-value { color: var(--warning); }

        .open-list {
          margin-top: 1rem;
          max-height: 200px;
          overflow-y: auto;
          color: var(--text-primary);
        }

        .open-item {
          background: #f8fafc;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.875rem;
          color: var(--text-primary);
          border: 1px solid var(--border);
        }

        .btn-small {
          padding: 6px 12px;
          font-size: 0.75rem;
          border-radius: 6px;
          margin-left: 4px;
          color: #fff;
        }

        .btn-close { 
          background: var(--danger); 
          color: #fff; 
        }

        .btn-view { 
          background: var(--success); 
          color: #fff; 
        }

        .clave-btn {
          width: 100%;
          background: linear-gradient(135deg, #1976d2 0%, #ffe066 100%);
          color: #1a1a2e;
          padding: 12px;
          border-radius: 8px;
          font-weight: 600;
          margin-top: 1rem;
          box-shadow: 0 2px 8px rgba(25, 118, 210, 0.15);
          border: 2px solid #ffe066;
        }

        .title {
          color: var(--text-primary);
          font-weight: 700;
          font-size: 1.05rem;
          margin: 0;
          letter-spacing: 0.4px;
        }

        .table-container {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: var(--shadow);
          color: var(--text-primary);
          border: 1px solid var(--border);
        }

        .table {
          width: 100%;
          border-collapse: collapse;
          color: var(--text-primary);
        }

        .table th {
          background: #f8fafc;
          padding: 1rem;
          text-align: left;
          font-weight: 600;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border);
        }

        .table td {
          padding: 1rem;
          border-bottom: 1px solid var(--border);
          color: var(--text-primary);
        }

        .status-sin-aclarar { 
          color: var(--danger); 
          background: rgba(198,40,40,0.1); 
          padding: 4px 8px; 
          border-radius: 6px; 
          font-weight: 600; 
        }

        .status-cuadrado { 
          color: var(--success); 
          background: rgba(46,125,50,0.1); 
          padding: 4px 8px; 
          border-radius: 6px; 
          font-weight: 600; 
        }

        .status-aclarado { 
          color: var(--info); 
          background: rgba(25,118,210,0.1); 
          padding: 4px 8px; 
          border-radius: 6px; 
          font-weight: 600; 
        }

        .btn-aclarar {
          background: var(--success);
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 0.75rem;
          margin-left: 8px;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal {
          background: #ffffff;
          backdrop-filter: blur(8px);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 2rem;
          min-width: 400px;
          max-width: 90vw;
          max-height: 90vh;
          overflow-y: auto;
          color: #0f172a;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.2);
        }

        .modal-title {
          color: #0f172a;
          font-size: 1.25rem;
          font-weight: 800;
          margin-bottom: 1rem;
        }

        .clave-display {
          font-size: 3rem;
          font-weight: 800;
          letter-spacing: 6px;
          text-align: center;
          background: linear-gradient(135deg, #9c27b0, #ba68c8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 1rem 0;
        }

        .valores-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 1rem;
          margin: 1rem 0;
          color: var(--text-primary);
        }

        .valor-item {
          background: #f8fafc;
          padding: 1rem;
          border-radius: 8px;
          text-align: center;
          border: 1px solid var(--border);
          color: var(--text-primary);
        }

        .valor-diferencia {
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--text-primary);
        }

        .loading {
          text-align: center;
          padding: 3rem;
          color: var(--text-secondary);
        }

        .cierres-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-top: 1rem;
        }

        .cierre-card {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.25rem 1.5rem;
          box-shadow: var(--shadow);
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 1rem;
          align-items: start;
          transition: box-shadow 0.2s;
        }

        .cierre-card:hover {
          box-shadow: var(--shadow-hover);
        }

        .cierre-card-left {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          min-width: 72px;
        }

        .cierre-tipo-badge {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 20px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
        }

        .badge-apertura {
          background: #d1fae5;
          color: #065f46;
        }

        .badge-cierre {
          background: #fee2e2;
          color: #991b1b;
        }

        .cierre-fecha {
          font-size: 0.78rem;
          color: var(--text-secondary);
          text-align: center;
        }

        .cierre-card-body {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 0.6rem 1.2rem;
          align-items: start;
        }

        .cierre-field {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .cierre-field-label {
          font-size: 0.7rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }

        .cierre-field-value {
          font-size: 0.9rem;
          color: var(--text-primary);
          font-weight: 600;
        }

        .diferencia-positive { color: #10b981; }
        .diferencia-negative { color: #ef4444; }
        .diferencia-zero { color: #64748b; }

        .cierre-card-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          min-width: 110px;
        }

        .obs-badge {
          font-size: 0.75rem;
          font-weight: 700;
          padding: 4px 12px;
          border-radius: 20px;
          white-space: nowrap;
        }

        .obs-sin-aclarar {
          background: #fee2e2;
          color: #991b1b;
        }

        .obs-cuadrado {
          background: #d1fae5;
          color: #065f46;
        }

        .obs-aclarado {
          background: #dbeafe;
          color: #1e40af;
        }

        .diferencia-big {
          font-size: 1.1rem;
          font-weight: 800;
        }

        @media (max-width: 640px) {
          .cierre-card {
            grid-template-columns: 1fr;
          }
          .cierre-card-left {
            flex-direction: row;
            align-items: center;
            min-width: unset;
          }
          .cierre-card-right {
            flex-direction: row;
            align-items: center;
            flex-wrap: wrap;
            min-width: unset;
          }
        }

        @media (max-width: 768px) {
          .header { flex-direction: column; gap: 1rem; }
          .stats-grid { grid-template-columns: 1fr; }
          .open-item { flex-direction: column; gap: 8px; text-align: center; }
          .valores-grid { grid-template-columns: 1fr; }
          .cierres-enterprise { padding: 1rem; }
        }
      `}</style>

      <div className="container">
        <div
          style={{
            marginBottom: "20px",
            borderRadius: "14px",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #0b4f9a 0%, #1976d2 100%)",
              color: "#fff",
              padding: "24px 28px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "26px",
                  fontWeight: 900,
                  letterSpacing: 0.8,
                }}
              >
                🔒 Cierres Administrativos
              </h1>
              <p style={{ margin: 0, fontSize: "12px", opacity: 0.92 }}>
                Control de aperturas, cierres y diferencias por turno
              </p>
            </div>
            <button
              onClick={onVolver ? onVolver : () => window.history.back()}
              style={{
                background: "rgba(255,255,255,0.18)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.35)",
                borderRadius: "8px",
                padding: "10px 16px",
                fontWeight: 700,
                cursor: "pointer",
                backdropFilter: "blur(2px)",
              }}
            >
              ← Volver
            </button>
          </div>

          <div
            style={{
              background: "#fff",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              borderTop: "1px solid #dbe2ea",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderRight: "1px solid #e2e8f0",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#64748b",
                  textTransform: "uppercase",
                }}
              >
                Cajas Abiertas
              </div>
              <div
                style={{ fontSize: "24px", fontWeight: 900, color: "#16a34a" }}
              >
                {cajasAbiertas}
              </div>
            </div>
            <div
              style={{
                padding: "14px 16px",
                borderRight: "1px solid #e2e8f0",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#64748b",
                  textTransform: "uppercase",
                }}
              >
                Cierres Filtrados
              </div>
              <div
                style={{ fontSize: "24px", fontWeight: 900, color: "#1d4ed8" }}
              >
                {cierresFiltrados.length}
              </div>
            </div>
            <div
              style={{
                padding: "14px 16px",
                borderRight: "1px solid #e2e8f0",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#64748b",
                  textTransform: "uppercase",
                }}
              >
                Dif. Sin Aclarar
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: 900,
                  color: sumaDiferencia >= 0 ? "#dc2626" : "#16a34a",
                }}
              >
                L{" "}
                {sumaDiferencia.toLocaleString("de-DE", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>
            <div style={{ padding: "14px 16px", textAlign: "center" }}>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#64748b",
                  textTransform: "uppercase",
                }}
              >
                Rango
              </div>
              <div
                style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}
              >
                {fechaDesde || "—"} {fechaHasta ? `→ ${fechaHasta}` : ""}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginBottom: "20px",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "16px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                📅 Desde
              </label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  color: "#0f172a",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                📋 Hasta
              </label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  color: "#0f172a",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <button
              onClick={() => {
                setFechaDesde("");
                setFechaHasta("");
              }}
              style={{
                padding: "10px 16px",
                background: "#e2e8f0",
                color: "#334155",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              ♻️ Todos
            </button>
            <button
              onClick={() => setFiltroId(null)}
              style={{
                padding: "10px 16px",
                background: "#dbeafe",
                color: "#1d4ed8",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
              disabled={filtroId === null}
            >
              🔎 Quitar filtro caja
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                color: "#fff",
                padding: "14px 16px",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              🟢 Cajas Abiertas
            </div>
            <div style={{ padding: 14, maxHeight: 280, overflowY: "auto" }}>
              {cajasAbiertasList.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  No hay cajas abiertas.
                </div>
              ) : (
                cajasAbiertasList.map((ap, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: "1px solid #dcfce7",
                      background: "#f0fdf4",
                      borderRadius: 10,
                      padding: "10px 12px",
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#14532d" }}>
                      <strong>Caja {ap.caja}</strong> · {ap.cajero}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => handleVerCaja(ap)}
                        style={{
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          background: "#2563eb",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        👁️ Ver
                      </button>
                      <button
                        onClick={() => handleAbrirCierre(ap)}
                        style={{
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          background: "#dc2626",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        🔒 Cerrar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
                color: "#fff",
                padding: "14px 16px",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              ⚠️ Diferencias por Aclarar
            </div>
            <div style={{ padding: "14px 16px" }}>
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "#64748b",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  Total diferencia
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 900,
                    color: sumaDiferencia >= 0 ? "#dc2626" : "#16a34a",
                  }}
                >
                  L{" "}
                  {sumaDiferencia.toLocaleString("de-DE", {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 8,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}
                  >
                    Efectivo
                  </div>
                  <div
                    style={{ fontSize: 13, fontWeight: 800, color: "#166534" }}
                  >
                    L{" "}
                    {sumaEfectivoSinAclarar.toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 8,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}
                  >
                    Tarjeta
                  </div>
                  <div
                    style={{ fontSize: 13, fontWeight: 800, color: "#1d4ed8" }}
                  >
                    L{" "}
                    {sumaTarjetaSinAclarar.toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 8,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}
                  >
                    Transfer.
                  </div>
                  <div
                    style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed" }}
                  >
                    L{" "}
                    {sumaTransferenciasSinAclarar.toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
            padding: "12px 16px",
            marginBottom: 12,
          }}
        >
          <h2 className="title">📊 Cierres Registrados</h2>
        </div>
        {loading ? (
          <div className="loading">⏳ Cargando cierres...</div>
        ) : cierresFiltrados.length === 0 ? (
          <div className="loading">
            No hay registros para la fecha seleccionada.
          </div>
        ) : (
          <div className="cierres-list">
            {cierresFiltrados.map((c, idx) => {
              const tipo = c.tipo_registro || "";
              const fechaApertura = c.fecha_apertura || c.fecha;
              const fechaCierre =
                c.fecha_cierre || (tipo === "cierre" ? c.fecha : "");
              const fecha = fechaApertura
                ? fechaApertura.slice(0, 16).replace("T", " ")
                : "—";
              const aperturaCerrada =
                tipo === "apertura" ? aperturaTieneCierre(c, cierres) : false;
              const diferencia = parseFloat(c.diferencia || 0);
              const difClass =
                diferencia > 0
                  ? "diferencia-positive"
                  : diferencia < 0
                    ? "diferencia-negative"
                    : "diferencia-zero";
              const obs = c.observacion || "";
              const obsClass =
                obs === "sin aclarar"
                  ? "obs-sin-aclarar"
                  : obs === "cuadrado"
                    ? "obs-cuadrado"
                    : obs === "aclarado"
                      ? "obs-aclarado"
                      : "obs-cuadrado";
              return (
                <div key={c.id || idx} className="cierre-card">
                  {/* Columna izq: tipo + fecha */}
                  <div className="cierre-card-left">
                    <span
                      className={`cierre-tipo-badge ${tipo === "apertura" ? "badge-apertura" : "badge-cierre"}`}
                    >
                      {tipo === "apertura" ? "🟢 Apertura" : "🔒 Cierre"}
                    </span>
                    <span className="cierre-fecha">Apertura: {fecha}</span>
                    {fechaCierre && (
                      <span className="cierre-fecha" style={{ opacity: 0.85 }}>
                        Cierre: {fechaCierre.slice(0, 16).replace("T", " ")}
                      </span>
                    )}
                  </div>

                  {/* Cuerpo: campos clave */}
                  <div className="cierre-card-body">
                    <div className="cierre-field">
                      <span className="cierre-field-label">👤 Cajero</span>
                      <span className="cierre-field-value">
                        {c.cajero || "—"}
                      </span>
                    </div>
                    <div className="cierre-field">
                      <span className="cierre-field-label">📦 Caja</span>
                      <span className="cierre-field-value">
                        {c.caja || "—"}
                      </span>
                    </div>
                    {tipo === "cierre" && (
                      <>
                        <div className="cierre-field">
                          <span className="cierre-field-label">
                            💵 Efectivo Reg.
                          </span>
                          <span className="cierre-field-value">
                            L{" "}
                            {parseFloat(c.efectivo_registrado || 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="cierre-field">
                          <span className="cierre-field-label">
                            💵 Efectivo Día
                          </span>
                          <span className="cierre-field-value">
                            L {parseFloat(c.efectivo_dia || 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="cierre-field">
                          <span className="cierre-field-label">
                            💳 Tarjeta Reg.
                          </span>
                          <span className="cierre-field-value">
                            L{" "}
                            {parseFloat(
                              c.monto_tarjeta_registrado || 0,
                            ).toFixed(2)}
                          </span>
                        </div>
                        <div className="cierre-field">
                          <span className="cierre-field-label">
                            💳 Tarjeta Día
                          </span>
                          <span className="cierre-field-value">
                            L {parseFloat(c.monto_tarjeta_dia || 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="cierre-field">
                          <span className="cierre-field-label">
                            🏦 Transf. Reg.
                          </span>
                          <span className="cierre-field-value">
                            L{" "}
                            {parseFloat(
                              c.transferencias_registradas || 0,
                            ).toFixed(2)}
                          </span>
                        </div>
                        <div className="cierre-field">
                          <span className="cierre-field-label">
                            🏦 Transf. Día
                          </span>
                          <span className="cierre-field-value">
                            L {parseFloat(c.transferencias_dia || 0).toFixed(2)}
                          </span>
                        </div>
                        {(parseFloat(c.dolares_registrado || 0) > 0 ||
                          parseFloat(c.dolares_dia || 0) > 0) && (
                          <>
                            <div className="cierre-field">
                              <span className="cierre-field-label">
                                💱 Dólares Reg.
                              </span>
                              <span className="cierre-field-value">
                                ${" "}
                                {parseFloat(c.dolares_registrado || 0).toFixed(
                                  2,
                                )}
                              </span>
                            </div>
                            <div className="cierre-field">
                              <span className="cierre-field-label">
                                💱 Dólares Día
                              </span>
                              <span className="cierre-field-value">
                                $ {parseFloat(c.dolares_dia || 0).toFixed(2)}
                              </span>
                            </div>
                          </>
                        )}
                        {c.referencia_aclaracion && (
                          <div
                            className="cierre-field"
                            style={{ gridColumn: "1 / -1" }}
                          >
                            <span className="cierre-field-label">
                              📝 Referencia
                            </span>
                            <span
                              className="cierre-field-value"
                              style={{
                                fontWeight: 400,
                                color: "#64748b",
                                fontSize: "0.85rem",
                              }}
                            >
                              {c.referencia_aclaracion}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {tipo === "apertura" && (
                      <div className="cierre-field">
                        <span className="cierre-field-label">
                          💰 Fondo Fijo
                        </span>
                        <span className="cierre-field-value">
                          L{" "}
                          {parseFloat(
                            c.fondo_fijo || c.fondo_fijo_registrado || 0,
                          ).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Columna der: diferencia + observacion */}
                  <div className="cierre-card-right">
                    {tipo === "cierre" && (
                      <>
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontSize: "0.7rem",
                              color: "#64748b",
                              textTransform: "uppercase",
                              fontWeight: 600,
                              marginBottom: 2,
                            }}
                          >
                            Diferencia
                          </div>
                          <div className={`diferencia-big ${difClass}`}>
                            L {diferencia.toFixed(2)}
                          </div>
                        </div>
                        <span className={`obs-badge ${obsClass}`}>
                          {obs || "—"}
                        </span>
                        {obs === "sin aclarar" && (
                          <button
                            className="btn-aclarar"
                            onClick={() => handleAclararCierre(c.id)}
                            style={{
                              fontSize: 12,
                              padding: "5px 12px",
                              borderRadius: 8,
                              border: "none",
                              cursor: "pointer",
                              background: "#10b981",
                              color: "#fff",
                              fontWeight: 700,
                            }}
                          >
                            ✅ Aclarar
                          </button>
                        )}
                        <button
                          className="btn-aclarar"
                          onClick={() => handleReaperturarCaja(c)}
                          style={{
                            fontSize: 12,
                            padding: "5px 12px",
                            borderRadius: 8,
                            border: "none",
                            cursor: "pointer",
                            background: "#1976d2",
                            color: "#fff",
                            fontWeight: 700,
                          }}
                        >
                          🔓 Reaperturar caja
                        </button>
                      </>
                    )}
                    {tipo === "apertura" &&
                      (aperturaCerrada ? (
                        <span className="obs-badge obs-cuadrado">
                          🔒 Cerrada
                        </span>
                      ) : (
                        <button
                          className="btn-aclarar"
                          onClick={() => handleAbrirCierre(c)}
                          style={{
                            fontSize: 12,
                            padding: "5px 12px",
                            borderRadius: 8,
                            border: "none",
                            cursor: "pointer",
                            background: "#f59e0b",
                            color: "#fff",
                            fontWeight: 700,
                          }}
                        >
                          🔒 Cerrar caja
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Cierre - CORREGIDO */}
        {showCierreModal && cajaCierre && (
          <div
            className="modal-overlay"
            onClick={() => setShowCierreModal(false)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">🔒 Cerrar Caja</h3>
              <div
                style={{
                  margin: "1rem 0",
                  padding: "1rem",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                }}
              >
                <p>
                  <strong>📦 Caja:</strong> {cajaCierre.caja}
                </p>
                <p>
                  <strong>👤 Cajero:</strong> {cajaCierre.cajero}
                </p>
                <p>
                  <strong>📅 Fecha:</strong> {cajaCierre.fecha.slice(0, 10)}
                </p>
                {valoresCierre && (
                  <div className="valores-grid">
                    <div className="valor-item">
                      <div>Fondo fijo</div>
                      <div>L {valoresCierre.fondoFijoDia.toFixed(2)}</div>
                    </div>
                    <div className="valor-item">
                      <div>Efectivo</div>
                      <div>L {valoresCierre.efectivoDia.toFixed(2)}</div>
                    </div>
                    <div className="valor-item">
                      <div>Tarjeta</div>
                      <div>L {valoresCierre.tarjetaDia.toFixed(2)}</div>
                    </div>
                    <div className="valor-item">
                      <div>Transferencias</div>
                      <div>L {valoresCierre.transferenciasDia.toFixed(2)}</div>
                    </div>
                    <div
                      className="valor-item valor-diferencia"
                      style={{
                        color:
                          valoresCierre.diferencia === 0
                            ? "var(--success)"
                            : "var(--danger)",
                        background:
                          valoresCierre.diferencia === 0
                            ? "rgba(46,125,50,0.1)"
                            : "rgba(198,40,40,0.1)",
                      }}
                    >
                      <div>
                        <strong>Total</strong>
                      </div>
                      <div>
                        <strong>L {valoresCierre.diferencia.toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {cierreError && (
                <p style={{ color: "var(--danger)", margin: "1rem 0" }}>
                  {cierreError}
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  gap: "1rem",
                  justifyContent: "center",
                }}
              >
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setShowCierreModal(false);
                    setValoresCierre(null);
                  }}
                  disabled={cerrandoCaja}
                >
                  Cancelar
                </button>
                <button
                  className="btn-primary"
                  onClick={handleCerrarCaja}
                  disabled={cerrandoCaja}
                >
                  {cerrandoCaja ? "⏳ Cerrando..." : "✅ Confirmar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de clave eliminado */}
      </div>
    </div>
  );
}
