import React, { useEffect, useState } from "react";
import PrecioDolarModal from "./PrecioDolarModal";

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface CaiFactura {
  id: string;
  cai: string;
  rango_desde: number;
  rango_hasta: number;
  caja_asignada: string;
  cajero_id: string;
  factura_actual?: string;
  creado_en?: string;
  // Campos SAR Honduras
  tipo_comprobante: "FACTURA" | "RECIBO";
  tipo_documento: "01" | "02" | "03";
  numero_establecimiento: string;
  punto_emision: string;
  fecha_limite_emision?: string;
  activo: boolean;
}

interface Usuario {
  id: string;
  nombre: string;
  rol: string;
  caja?: string;
}

interface CaiFacturasViewProps {
  onBack?: () => void;
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/cai_facturas`;
const API_KEY = import.meta.env.VITE_SUPABASE_KEY || "";
const USUARIOS_URL = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/usuarios?rol=eq.cajero`;

type FormState = Partial<CaiFactura>;

// ─── Helpers visuales ─────────────────────────────────────────────────────────
function BadgeTipo({ tipo }: { tipo?: "FACTURA" | "RECIBO" }) {
  if (tipo === "FACTURA") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "#dcfce7",
          color: "#16a34a",
          border: "1px solid #bbf7d0",
          borderRadius: 99,
          padding: "2px 10px",
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        🏛️ FACTURA SAR
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "#dbeafe",
        color: "#1d4ed8",
        border: "1px solid #bfdbfe",
        borderRadius: 99,
        padding: "2px 10px",
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      🧾 RECIBO
    </span>
  );
}

function BadgeActivo({ activo }: { activo: boolean }) {
  return activo ? (
    <span
      style={{
        background: "#f0fdf4",
        color: "#16a34a",
        border: "1px solid #bbf7d0",
        borderRadius: 99,
        padding: "2px 9px",
        fontWeight: 600,
        fontSize: 11,
      }}
    >
      ● Activo
    </span>
  ) : (
    <span
      style={{
        background: "#fef2f2",
        color: "#dc2626",
        border: "1px solid #fecaca",
        borderRadius: 99,
        padding: "2px 9px",
        fontWeight: 600,
        fontSize: 11,
      }}
    >
      ○ Inactivo
    </span>
  );
}

// ─── Estilos CSS ──────────────────────────────────────────────────────────────
const CSS = `
body, #root {
  width: 100vw !important; height: 100vh !important;
  min-width: 100vw !important; min-height: 100vh !important;
  margin: 0 !important; padding: 0 !important;
  box-sizing: border-box !important; display: block !important;
  max-width: none !important; background: unset !important;
}
.cai-root {
  min-height: 100vh; min-width: 100vw;
  background: linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow-x: hidden;
}
.cai-header {
  background: rgba(255,255,255,0.95); backdrop-filter: blur(20px);
  border-bottom: 1px solid #e2e8f0; padding: 1.25rem 2.5rem;
  display: flex; justify-content: space-between; align-items: center;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.cai-btn-back {
  background: #fff; color: #0f172a;
  border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 16px;
  font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px;
}
.cai-btn-back:hover { background: #f1f5f9; }
.cai-page-title { color: #0f172a; font-size: 1.4rem; font-weight: 800; margin: 0; }
.cai-btn-primary {
  background: linear-gradient(135deg, #3b82f6, #42a5f5); color: white;
  border: none; border-radius: 8px; padding: 10px 18px; font-weight: 700;
  cursor: pointer; display: flex; align-items: center; gap: 7px; font-size: 14px;
}
.cai-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(25,118,210,0.4); }
.cai-main { padding: 1.75rem 2rem; max-width: 1400px; margin: 0 auto; }
.cai-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.cai-stat {
  background: white; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 1.1rem 1rem; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  transition: all 0.3s ease;
}
.cai-stat:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(0,0,0,0.12); }
.cai-stat-val { font-size: 1.9rem; font-weight: 800; color: #3b82f6; }
.cai-stat-lbl { color: #64748b; font-size: 0.8rem; margin-top: 2px; }
.cai-error { background: rgba(239,68,68,0.08); color: #dc2626; padding: 0.85rem 1rem; border-radius: 8px; border-left: 3px solid #ef4444; margin-bottom: 1rem; font-size: 13px; }
.cai-filter-tabs { display: flex; gap: 8px; margin-bottom: 1rem; flex-wrap: wrap; }
.cai-ftab {
  padding: 7px 18px; border-radius: 99px; font-weight: 700; font-size: 13px;
  border: 1.5px solid #e2e8f0; background: #fff; color: #64748b; cursor: pointer; transition: all 0.15s;
}
.cai-ftab.at { background: #1e293b; color: #fff; border-color: #1e293b; }
.cai-ftab.af { background: #dcfce7; color: #16a34a; border-color: #86efac; }
.cai-ftab.ar { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }
.cai-table-wrap {
  background: white; border-radius: 14px; overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06); margin-bottom: 1.5rem; border: 1px solid #e2e8f0;
}
.cai-table { width: 100%; border-collapse: collapse; }
.cai-table th {
  background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%);
  padding: 0.85rem 1rem; text-align: left; font-weight: 700;
  color: #0f172a; border-bottom: 1px solid #e2e8f0; font-size: 13px;
}
.cai-table td { padding: 0.9rem 1rem; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 13px; vertical-align: middle; }
.cai-table tr:last-child td { border-bottom: none; }
.cai-table tr:hover td { background: #f8fafc; }
.cai-btn-edit { padding: 5px 11px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-right: 6px; cursor: pointer; border: none; background: rgba(255,152,0,0.15); color: #b45309; transition: all 0.15s; }
.cai-btn-edit:hover { background: rgba(255,152,0,0.28); }
.cai-btn-del { padding: 5px 11px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; background: rgba(239,68,68,0.12); color: #dc2626; transition: all 0.15s; }
.cai-btn-del:hover { background: rgba(239,68,68,0.25); }
.cai-loading { text-align: center; padding: 2.5rem; color: #64748b; }
/* Modal */
.cai-overlay {
  position: fixed; inset: 0; background: rgba(15,23,42,0.72);
  backdrop-filter: blur(10px); display: flex; align-items: center;
  justify-content: center; z-index: 9999;
}
.cai-modal {
  background: #fff; border-radius: 20px; padding: 28px 30px 24px;
  width: 96%; max-width: 580px; max-height: 92vh; overflow-y: auto;
  box-shadow: 0 24px 64px rgba(15,23,42,0.22), 0 0 0 1px rgba(100,116,139,0.1);
}
.cai-modal-hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.cai-modal-title { font-size: 19px; font-weight: 900; color: #0f172a; margin: 0 0 3px; }
.cai-modal-sub { font-size: 12px; color: #64748b; margin: 3px 0 0; }
.cai-modal-close {
  background: #f1f5f9; border: 1px solid #e2e8f0; color: #64748b;
  border-radius: 8px; width: 34px; height: 34px; cursor: pointer; font-size: 15px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cai-modal-close:hover { background: #e2e8f0; }
.cai-sec-title {
  font-size: 11px; font-weight: 800; color: #6366f1; text-transform: uppercase;
  letter-spacing: 1px; margin: 16px 0 10px;
}
.cai-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cai-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.cai-lbl {
  display: block; font-size: 11.5px; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px;
}
.cai-input, .cai-select {
  width: 100%; padding: 9px 12px; border: 1.5px solid #e2e8f0;
  border-radius: 9px; font-size: 13.5px; color: #0f172a; outline: none;
  transition: border 150ms, box-shadow 150ms; box-sizing: border-box; background: #f8fafc;
}
.cai-input:focus, .cai-select:focus {
  border-color: #6366f1; background: #fff; box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
}
.cai-input::placeholder { color: #94a3b8; }
.cai-input[readonly] { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }
/* Tipo selector */
.cai-tipo-sel { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cai-tipo-btn {
  padding: 14px 8px; border-radius: 12px; border: 2px solid #e2e8f0;
  background: #f8fafc; cursor: pointer; text-align: center; transition: all 0.15s;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.cai-tipo-btn.sf { border-color: #16a34a; background: #f0fdf4; }
.cai-tipo-btn.sr { border-color: #1d4ed8; background: #eff6ff; }
/* Toggle */
.cai-toggle-row { display: flex; align-items: center; gap: 12px; padding: 11px 14px; background: #f8fafc; border-radius: 10px; border: 1.5px solid #e2e8f0; }
.cai-toggle-lbl { flex: 1; font-size: 13px; font-weight: 600; color: #374151; }
.cai-toggle {
  width: 44px; height: 24px; border-radius: 99px; border: none; cursor: pointer;
  position: relative; transition: background 0.2s; flex-shrink: 0;
}
.cai-toggle::after {
  content: ''; position: absolute; top: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: white; transition: left 0.2s;
}
.cai-toggle.on { background: #16a34a; }
.cai-toggle.on::after { left: 23px; }
.cai-toggle.off { background: #94a3b8; }
.cai-toggle.off::after { left: 3px; }
/* Footer modal */
.cai-modal-footer { display: flex; gap: 10px; margin-top: 20px; }
.cai-btn-cancel {
  flex: 1; padding: 11px 0; border: 1.5px solid #e2e8f0; border-radius: 10px;
  background: #fff; color: #64748b; font-weight: 700; font-size: 14px; cursor: pointer;
}
.cai-btn-cancel:hover { background: #f8fafc; }
.cai-btn-save {
  flex: 2; padding: 11px 0; border: none; border-radius: 10px;
  color: #fff; font-weight: 800; font-size: 14px; cursor: pointer; transition: all 0.15s;
}
.cai-note { font-size: 11px; color: #64748b; padding: 8px 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #6366f1; margin-top: 6px; }
.cai-divider { height: 1px; background: #f1f5f9; margin: 6px 0; }
/* SAR box */
.cai-sar-box {
  padding: 14px 16px; border-radius: 12px;
  background: #f0fdf4; border: 1.5px solid #bbf7d0; margin-top: 2px;
}
/* Responsive */
@media (max-width: 900px) {
  .cai-header { padding: 1rem; flex-direction: column; gap: 10px; align-items: flex-start; }
  .cai-main { padding: 1rem; }
  .cai-grid2, .cai-grid3 { grid-template-columns: 1fr; }
  .cai-table { display: none; }
  .cai-table-wrap { box-shadow: none; background: transparent; border: none; }
  .cai-cards { display: flex !important; }
}
.cai-cards { display: none; flex-direction: column; gap: 10px; padding: 12px; }
`;

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CaiFacturasView({ onBack }: CaiFacturasViewProps) {
  const [facturas, setFacturas] = useState<CaiFactura[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>({
    tipo_comprobante: "FACTURA",
    tipo_documento: "01",
    numero_establecimiento: "001",
    punto_emision: "001",
    activo: true,
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showPrecioModal, setShowPrecioModal] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<"TODOS" | "FACTURA" | "RECIBO">(
    "TODOS",
  );

  // ── Carga ─────────────────────────────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    try {
      const [fRes, uRes] = await Promise.all([
        fetch(API_URL + "?select=*&order=creado_en.desc", {
          headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
        }),
        fetch(USUARIOS_URL, {
          headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
        }),
      ]);
      const fData = await fRes.json();
      const uData = await uRes.json();
      setFacturas(Array.isArray(fData) ? fData : []);
      setUsuarios(Array.isArray(uData) ? uData : []);
    } catch {
      setError("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ── Reset form ────────────────────────────────────────────────────────────
  const resetForm = () => {
    setEditId(null);
    setForm({
      tipo_comprobante: "FACTURA",
      tipo_documento: "01",
      numero_establecimiento: "001",
      punto_emision: "001",
      activo: true,
    });
    setError("");
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if ((form.rango_desde ?? 0) <= 0) {
      setError("El rango desde debe ser mayor a 0.");
      return;
    }
    if ((form.rango_hasta ?? 0) < (form.rango_desde ?? 0)) {
      setError("El rango hasta debe ser ≥ al rango desde.");
      return;
    }
    if (form.tipo_comprobante === "FACTURA" && !form.fecha_limite_emision) {
      setError("La fecha límite de emisión es obligatoria para FACTURA SAR.");
      return;
    }
    if (!/^\d{3}$/.test(form.numero_establecimiento ?? "")) {
      setError(
        "El número de establecimiento debe tener exactamente 3 dígitos.",
      );
      return;
    }
    if (!/^\d{3}$/.test(form.punto_emision ?? "")) {
      setError("El punto de emisión debe tener exactamente 3 dígitos.");
      return;
    }

    const cajaAuto = (() => {
      if (form.cajero_id) {
        const cajero = usuarios.find((u) => u.id === form.cajero_id);
        if (cajero?.caja) return cajero.caja;
      }
      return form.caja_asignada;
    })();

    const body: Record<string, unknown> = {
      cai: form.cai,
      rango_desde: Number(form.rango_desde),
      rango_hasta: Number(form.rango_hasta),
      cajero_id: form.cajero_id,
      caja_asignada: cajaAuto,
      tipo_comprobante: form.tipo_comprobante ?? "FACTURA",
      tipo_documento: form.tipo_documento ?? "01",
      numero_establecimiento: form.numero_establecimiento ?? "001",
      punto_emision: form.punto_emision ?? "001",
      activo: form.activo ?? true,
      fecha_limite_emision: form.fecha_limite_emision || null,
      factura_actual: form.factura_actual || null,
    };

    setLoading(true);
    try {
      const method = editId ? "PATCH" : "POST";
      const url = editId ? `${API_URL}?id=eq.${editId}` : API_URL;
      const res = await fetch(url, {
        method,
        headers: {
          apikey: API_KEY,
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        if (text.includes("uq_cai_activo_por_cajero_tipo")) {
          setError(
            `Ya existe un CAI de tipo ${form.tipo_comprobante} ACTIVO asignado a este cajero. Desactiva el anterior antes de crear uno nuevo.`,
          );
        } else {
          setError("Error al guardar: " + text);
        }
        return;
      }
      setShowModal(false);
      resetForm();
      await fetchData();
    } catch {
      setError("Error de conexión al guardar.");
    } finally {
      setLoading(false);
    }
  };

  // ── Eliminar ──────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar este registro CAI permanentemente?")) return;
    setLoading(true);
    try {
      await fetch(`${API_URL}?id=eq.${id}`, {
        method: "DELETE",
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
      });
      await fetchData();
    } catch {
      setError("Error al eliminar");
    } finally {
      setLoading(false);
    }
  };

  // ── Editar ────────────────────────────────────────────────────────────────
  const handleEdit = (f: CaiFactura) => {
    setEditId(f.id);
    setForm({
      cai: f.cai,
      rango_desde: f.rango_desde,
      rango_hasta: f.rango_hasta,
      cajero_id: f.cajero_id,
      caja_asignada: f.caja_asignada,
      factura_actual: f.factura_actual,
      tipo_comprobante: f.tipo_comprobante ?? "FACTURA",
      tipo_documento: f.tipo_documento ?? "01",
      numero_establecimiento: f.numero_establecimiento ?? "001",
      punto_emision: f.punto_emision ?? "001",
      fecha_limite_emision: f.fecha_limite_emision ?? "",
      activo: f.activo ?? true,
    });
    setShowModal(true);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalRegistros = facturas.length;
  const totalFacturaSar = facturas.filter(
    (f) => f.tipo_comprobante === "FACTURA",
  ).length;
  const totalRecibo = facturas.filter(
    (f) => f.tipo_comprobante === "RECIBO",
  ).length;
  const cajerosActivos = new Set(
    facturas.filter((f) => f.activo).map((f) => f.cajero_id),
  ).size;
  const caiActivos = facturas.filter((f) => f.activo).length;

  const facturasFiltradas =
    filtroTipo === "TODOS"
      ? facturas
      : facturas.filter((f) => f.tipo_comprobante === filtroTipo);

  // ── Helpers form ──────────────────────────────────────────────────────────
  const getCajaForm = () => {
    if (form.cajero_id) {
      const c = usuarios.find((u) => u.id === form.cajero_id);
      if (c?.caja) return c.caja;
    }
    return form.caja_asignada ?? "";
  };
  const cajaEsAuto = !!(
    form.cajero_id && usuarios.find((u) => u.id === form.cajero_id)?.caja
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="cai-root" style={{ width: "100vw", minHeight: "100vh" }}>
      <style>{CSS}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="cai-header">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {onBack && (
            <button className="cai-btn-back" onClick={onBack}>
              ← Volver
            </button>
          )}
          <div>
            <h1 className="cai-page-title">🧾 CAI y Facturación SAR</h1>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
              Administración de comprobantes — SAR Honduras
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="cai-btn-primary"
            onClick={() => setShowPrecioModal(true)}
            style={{ background: "#10b981" }}
          >
            💵 Precio del dólar
          </button>
          <button
            className="cai-btn-primary"
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
          >
            ➕ Nuevo CAI
          </button>
        </div>
      </header>

      <main className="cai-main">
        {/* ── Estadísticas ──────────────────────────────────────────────── */}
        <div className="cai-stats">
          <div className="cai-stat">
            <div className="cai-stat-val">{totalRegistros}</div>
            <div className="cai-stat-lbl">Total Registros</div>
          </div>
          <div className="cai-stat" style={{ borderTop: "3px solid #16a34a" }}>
            <div className="cai-stat-val" style={{ color: "#16a34a" }}>
              {totalFacturaSar}
            </div>
            <div className="cai-stat-lbl">🏛️ CAI Factura SAR</div>
          </div>
          <div className="cai-stat" style={{ borderTop: "3px solid #1d4ed8" }}>
            <div className="cai-stat-val" style={{ color: "#1d4ed8" }}>
              {totalRecibo}
            </div>
            <div className="cai-stat-lbl">🧾 CAI Recibo</div>
          </div>
          <div className="cai-stat">
            <div className="cai-stat-val">{cajerosActivos}</div>
            <div className="cai-stat-lbl">Cajeros c/ CAI activo</div>
          </div>
          <div className="cai-stat">
            <div className="cai-stat-val">{caiActivos}</div>
            <div className="cai-stat-lbl">CAI Activos</div>
          </div>
          <div className="cai-stat">
            <div className="cai-stat-val">{usuarios.length}</div>
            <div className="cai-stat-lbl">Total Cajeros</div>
          </div>
        </div>

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {error && <div className="cai-error">⚠️ {error}</div>}

        {/* ── Filtros ───────────────────────────────────────────────────── */}
        <div className="cai-filter-tabs">
          <button
            className={`cai-ftab ${filtroTipo === "TODOS" ? "at" : ""}`}
            onClick={() => setFiltroTipo("TODOS")}
          >
            Todos ({totalRegistros})
          </button>
          <button
            className={`cai-ftab ${filtroTipo === "FACTURA" ? "af" : ""}`}
            onClick={() => setFiltroTipo("FACTURA")}
          >
            🏛️ Factura SAR ({totalFacturaSar})
          </button>
          <button
            className={`cai-ftab ${filtroTipo === "RECIBO" ? "ar" : ""}`}
            onClick={() => setFiltroTipo("RECIBO")}
          >
            🧾 Recibo ({totalRecibo})
          </button>
        </div>

        {/* ── Tabla / Cards ─────────────────────────────────────────────── */}
        {loading ? (
          <div className="cai-loading">⏳ Cargando registros CAI...</div>
        ) : (
          <div className="cai-table-wrap">
            {/* Tabla escritorio */}
            <table className="cai-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>CAI</th>
                  <th>Cajero</th>
                  <th>Caja</th>
                  <th>Rango / Progreso</th>
                  <th>Actual</th>
                  <th>Fecha Límite</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {facturasFiltradas.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        textAlign: "center",
                        padding: "2rem",
                        color: "#94a3b8",
                      }}
                    >
                      No hay registros para mostrar
                    </td>
                  </tr>
                ) : (
                  facturasFiltradas.map((f) => {
                    const cajero = usuarios.find((u) => u.id === f.cajero_id);
                    const actual = Number(
                      f.factura_actual ?? f.rango_desde - 1,
                    );
                    const total = f.rango_hasta - f.rango_desde + 1;
                    const usados = actual - f.rango_desde + 1;
                    const pct =
                      total > 0
                        ? Math.min(Math.round((usados / total) * 100), 100)
                        : 0;
                    const disponibles = f.rango_hasta - actual;
                    const vencida = f.fecha_limite_emision
                      ? new Date(f.fecha_limite_emision) < new Date()
                      : false;
                    const barColor =
                      pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#10b981";

                    return (
                      <tr key={f.id}>
                        <td>
                          <BadgeTipo tipo={f.tipo_comprobante} />
                        </td>
                        <td>
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontWeight: 700,
                              color: "#4f46e5",
                              fontSize: 12,
                            }}
                          >
                            {f.cai}
                          </span>
                          {f.tipo_comprobante === "FACTURA" && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#94a3b8",
                                marginTop: 2,
                              }}
                            >
                              Est.{f.numero_establecimiento ?? "001"} – Pt.
                              {f.punto_emision ?? "001"} – Doc.
                              {f.tipo_documento ?? "01"}
                            </div>
                          )}
                        </td>
                        <td style={{ color: "#f59e0b", fontWeight: 600 }}>
                          {cajero?.nombre ?? (
                            <span style={{ color: "#dc2626" }}>
                              Sin asignar
                            </span>
                          )}
                        </td>
                        <td style={{ color: "#10b981", fontWeight: 600 }}>
                          {f.caja_asignada}
                        </td>
                        <td>
                          <div style={{ fontSize: 12 }}>
                            {f.rango_desde.toLocaleString()} →{" "}
                            {f.rango_hasta.toLocaleString()}
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              height: 4,
                              background: "#e2e8f0",
                              borderRadius: 99,
                              overflow: "hidden",
                              width: 120,
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                borderRadius: 99,
                                width: `${pct}%`,
                                background: barColor,
                                transition: "width 0.3s",
                              }}
                            />
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "#94a3b8",
                              marginTop: 2,
                            }}
                          >
                            {disponibles.toLocaleString()} disponibles · {pct}%
                            usado
                          </div>
                        </td>
                        <td>
                          <strong style={{ color: "#6366f1" }}>
                            {f.factura_actual ?? "—"}
                          </strong>
                        </td>
                        <td>
                          {f.fecha_limite_emision ? (
                            <span
                              style={{
                                color: vencida ? "#dc2626" : "#16a34a",
                                fontWeight: 600,
                                fontSize: 12,
                              }}
                            >
                              {vencida ? "⚠️ " : "✓ "}
                              {new Date(
                                f.fecha_limite_emision,
                              ).toLocaleDateString("es-HN")}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </td>
                        <td>
                          <BadgeActivo activo={f.activo ?? true} />
                        </td>
                        <td>
                          <button
                            className="cai-btn-edit"
                            onClick={() => handleEdit(f)}
                          >
                            ✏️ Editar
                          </button>
                          <button
                            className="cai-btn-del"
                            onClick={() => handleDelete(f.id)}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Cards móviles */}
            <div className="cai-cards">
              {facturasFiltradas.map((f) => {
                const cajero = usuarios.find((u) => u.id === f.cajero_id);
                const vencida = f.fecha_limite_emision
                  ? new Date(f.fecha_limite_emision) < new Date()
                  : false;
                return (
                  <div
                    key={f.id}
                    style={{
                      background: "#fff",
                      borderRadius: 14,
                      padding: "14px 16px",
                      border: `1.5px solid ${f.tipo_comprobante === "FACTURA" ? "#bbf7d0" : "#bfdbfe"}`,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 8,
                      }}
                    >
                      <BadgeTipo tipo={f.tipo_comprobante} />
                      <BadgeActivo activo={f.activo ?? true} />
                    </div>
                    <div
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 800,
                        color: "#4f46e5",
                        fontSize: 13,
                        marginBottom: 4,
                      }}
                    >
                      {f.cai}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#64748b",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 3,
                      }}
                    >
                      <span>👤 {cajero?.nombre ?? "Sin asignar"}</span>
                      <span>🏪 {f.caja_asignada}</span>
                      <span>
                        Rango: {f.rango_desde.toLocaleString()}-
                        {f.rango_hasta.toLocaleString()}
                      </span>
                      <span>
                        Actual: <strong>{f.factura_actual ?? "—"}</strong>
                      </span>
                    </div>
                    {f.fecha_limite_emision && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: vencida ? "#dc2626" : "#16a34a",
                          fontWeight: 600,
                        }}
                      >
                        Vence:{" "}
                        {new Date(f.fecha_limite_emision).toLocaleDateString(
                          "es-HN",
                        )}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        className="cai-btn-edit"
                        onClick={() => handleEdit(f)}
                        style={{ flex: 1 }}
                      >
                        ✏️ Editar
                      </button>
                      <button
                        className="cai-btn-del"
                        onClick={() => handleDelete(f.id)}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════════════════
           MODAL REGISTRO / EDICIÓN
      ══════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <div
          className="cai-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowModal(false);
              resetForm();
            }
          }}
        >
          <div className="cai-modal">
            {/* Cabecera */}
            <div className="cai-modal-hdr">
              <div>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 2,
                    color: "#6366f1",
                    textTransform: "uppercase",
                    margin: "0 0 2px",
                  }}
                >
                  {editId ? "Editando registro" : "Nuevo registro"}
                </p>
                <h2 className="cai-modal-title">
                  {editId ? "✏️ Editar CAI" : "➕ Nuevo CAI"}
                </h2>
                <p className="cai-modal-sub">
                  {editId
                    ? "Modifica los datos del comprobante"
                    : "Registra un nuevo CAI de factura o recibo"}
                </p>
              </div>
              <button
                className="cai-modal-close"
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                height: 1,
                background:
                  "linear-gradient(90deg,transparent,#e2e8f0,transparent)",
                marginBottom: 18,
              }}
            />

            {error && (
              <div className="cai-error" style={{ marginBottom: 14 }}>
                ⚠️ {error}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              {/* ── Sección 1: Tipo de comprobante ───────────────────────── */}
              <div>
                <p className="cai-sec-title">📋 Tipo de Comprobante</p>
                <div className="cai-tipo-sel">
                  <button
                    type="button"
                    className={`cai-tipo-btn ${form.tipo_comprobante === "FACTURA" ? "sf" : ""}`}
                    onClick={() =>
                      setForm((p) => ({ ...p, tipo_comprobante: "FACTURA" }))
                    }
                  >
                    <span style={{ fontSize: 26 }}>🏛️</span>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: 14,
                        color:
                          form.tipo_comprobante === "FACTURA"
                            ? "#16a34a"
                            : "#374151",
                      }}
                    >
                      FACTURA SAR
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        lineHeight: 1.4,
                        textAlign: "center",
                      }}
                    >
                      Correlativo oficial SAR
                      <br />
                      con CAI y rango
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`cai-tipo-btn ${form.tipo_comprobante === "RECIBO" ? "sr" : ""}`}
                    onClick={() =>
                      setForm((p) => ({ ...p, tipo_comprobante: "RECIBO" }))
                    }
                  >
                    <span style={{ fontSize: 26 }}>🧾</span>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: 14,
                        color:
                          form.tipo_comprobante === "RECIBO"
                            ? "#1d4ed8"
                            : "#374151",
                      }}
                    >
                      RECIBO
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        lineHeight: 1.4,
                        textAlign: "center",
                      }}
                    >
                      Correlativo simple
                      <br />
                      sin formato SAR
                    </span>
                  </button>
                </div>
                <p className="cai-note">
                  {form.tipo_comprobante === "FACTURA"
                    ? "✅ Un cajero puede tener UN CAI FACTURA activo y UN CAI RECIBO activo al mismo tiempo."
                    : "ℹ️ El RECIBO no genera documento fiscal oficial ante el SAR."}
                </p>
              </div>

              {/* ── Sección 2: Código CAI y Rango ────────────────────────── */}
              <div>
                <p className="cai-sec-title">🔑 Código CAI y Rango</p>
                <div style={{ marginBottom: 12 }}>
                  <label className="cai-lbl">Código CAI *</label>
                  <input
                    type="text"
                    className="cai-input"
                    placeholder={
                      form.tipo_comprobante === "FACTURA"
                        ? "Ej: A1B2C3-D4E5F6-G7H8I9-J0K1L2-M3N4O5-P6"
                        : "Ej: RECIBO-001 (código interno)"
                    }
                    value={form.cai ?? ""}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, cai: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="cai-grid2">
                  <div>
                    <label className="cai-lbl">🔢 Rango Desde *</label>
                    <input
                      type="number"
                      className="cai-input"
                      placeholder="Ej: 1"
                      min={1}
                      value={form.rango_desde ?? ""}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          rango_desde: Number(e.target.value),
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="cai-lbl">🔢 Rango Hasta *</label>
                    <input
                      type="number"
                      className="cai-input"
                      placeholder="Ej: 1000"
                      min={1}
                      value={form.rango_hasta ?? ""}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          rango_hasta: Number(e.target.value),
                        }))
                      }
                      required
                    />
                  </div>
                </div>
              </div>

              {/* ── Sección 3: Datos SAR (solo FACTURA) ──────────────────── */}
              {form.tipo_comprobante === "FACTURA" && (
                <div className="cai-sar-box">
                  <p
                    className="cai-sec-title"
                    style={{ color: "#16a34a", margin: "0 0 12px" }}
                  >
                    🏛️ Datos Fiscales SAR
                  </p>

                  <div style={{ marginBottom: 12 }}>
                    <label className="cai-lbl">Tipo de Documento SAR *</label>
                    <select
                      className="cai-select"
                      value={form.tipo_documento ?? "01"}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          tipo_documento: e.target.value as "01" | "02" | "03",
                        }))
                      }
                      required
                    >
                      <option value="01">
                        01 — Factura de Consumidor Final
                      </option>
                      <option value="02">02 — Factura de Exportación</option>
                      <option value="03">
                        03 — Factura Servicios Empresariales
                      </option>
                    </select>
                  </div>

                  <div className="cai-grid2" style={{ marginBottom: 12 }}>
                    <div>
                      <label className="cai-lbl">
                        Nº Establecimiento *{" "}
                        <span
                          style={{
                            fontWeight: 400,
                            textTransform: "none",
                            fontSize: 10,
                            color: "#94a3b8",
                          }}
                        >
                          (3 dígitos)
                        </span>
                      </label>
                      <input
                        type="text"
                        className="cai-input"
                        placeholder="001"
                        maxLength={3}
                        value={form.numero_establecimiento ?? "001"}
                        onChange={(e) => {
                          const v = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 3);
                          setForm((p) => ({ ...p, numero_establecimiento: v }));
                        }}
                        required
                      />
                    </div>
                    <div>
                      <label className="cai-lbl">
                        Punto de Emisión *{" "}
                        <span
                          style={{
                            fontWeight: 400,
                            textTransform: "none",
                            fontSize: 10,
                            color: "#94a3b8",
                          }}
                        >
                          (3 dígitos)
                        </span>
                      </label>
                      <input
                        type="text"
                        className="cai-input"
                        placeholder="001"
                        maxLength={3}
                        value={form.punto_emision ?? "001"}
                        onChange={(e) => {
                          const v = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 3);
                          setForm((p) => ({ ...p, punto_emision: v }));
                        }}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="cai-lbl">
                      📅 Fecha Límite de Emisión *
                    </label>
                    <input
                      type="date"
                      className="cai-input"
                      value={form.fecha_limite_emision ?? ""}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          fecha_limite_emision: e.target.value,
                        }))
                      }
                      required
                    />
                  </div>

                  {form.numero_establecimiento?.length === 3 &&
                    form.punto_emision?.length === 3 && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "8px 12px",
                          background: "#dcfce7",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "#166534",
                        }}
                      >
                        <strong>Vista previa:</strong>{" "}
                        <code
                          style={{ fontFamily: "monospace", fontWeight: 700 }}
                        >
                          {form.numero_establecimiento}-{form.punto_emision}-
                          {form.tipo_documento ?? "01"}-00000001
                        </code>
                      </div>
                    )}
                </div>
              )}

              {/* ── Sección 4: Cajero / Caja ─────────────────────────────── */}
              <div>
                <p className="cai-sec-title">👤 Cajero y Caja</p>
                <div className="cai-grid2">
                  <div>
                    <label className="cai-lbl">Cajero Asignado *</label>
                    <select
                      className="cai-select"
                      value={form.cajero_id ?? ""}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, cajero_id: e.target.value }))
                      }
                      required
                    >
                      <option value="">Selecciona un cajero...</option>
                      {usuarios.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                          {u.caja ? ` (${u.caja})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="cai-lbl">
                      Caja {cajaEsAuto ? "(auto)" : "*"}
                    </label>
                    <input
                      type="text"
                      className="cai-input"
                      placeholder="Nombre de caja"
                      value={getCajaForm()}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          caja_asignada: e.target.value,
                        }))
                      }
                      readOnly={cajaEsAuto}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* ── Sección 5: Control y estado ──────────────────────────── */}
              <div>
                <p className="cai-sec-title">⚙️ Control y Estado</p>
                <div className="cai-grid2">
                  <div>
                    <label className="cai-lbl">
                      Factura Actual{" "}
                      <span
                        style={{
                          fontWeight: 400,
                          textTransform: "none",
                          color: "#94a3b8",
                          fontSize: 11,
                        }}
                      >
                        (opcional)
                      </span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="cai-input"
                      placeholder="Vacío = empieza desde el rango"
                      value={form.factura_actual ?? ""}
                      onChange={(e) => {
                        if (/^\d*$/.test(e.target.value))
                          setForm((p) => ({
                            ...p,
                            factura_actual: e.target.value,
                          }));
                      }}
                    />
                  </div>
                  <div>
                    <label className="cai-lbl">Estado</label>
                    <div className="cai-toggle-row">
                      <span className="cai-toggle-lbl">
                        {form.activo ? "✅ Activo" : "🔴 Inactivo"}
                      </span>
                      <button
                        type="button"
                        className={`cai-toggle ${form.activo ? "on" : "off"}`}
                        onClick={() =>
                          setForm((p) => ({ ...p, activo: !p.activo }))
                        }
                        title="Activar / Desactivar"
                      />
                    </div>
                  </div>
                </div>
                <p className="cai-note" style={{ marginTop: 10 }}>
                  Solo puede haber <strong>un CAI FACTURA activo</strong> y{" "}
                  <strong>un CAI RECIBO activo</strong> por cajero a la vez.
                  Desactiva el anterior para reemplazarlo.
                </p>
              </div>

              {/* ── Footer ───────────────────────────────────────────────── */}
              <div className="cai-divider" />
              <div className="cai-modal-footer">
                <button
                  type="button"
                  className="cai-btn-cancel"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="cai-btn-save"
                  disabled={loading}
                  style={{
                    background: loading
                      ? "#c7d2fe"
                      : form.tipo_comprobante === "RECIBO"
                        ? "linear-gradient(135deg,#1d4ed8,#3b82f6)"
                        : "linear-gradient(135deg,#16a34a,#22c55e)",
                    boxShadow: loading
                      ? "none"
                      : form.tipo_comprobante === "RECIBO"
                        ? "0 4px 14px rgba(29,78,216,0.35)"
                        : "0 4px 14px rgba(22,163,74,0.35)",
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading
                    ? "⏳ Guardando..."
                    : editId
                      ? "💾 Guardar Cambios"
                      : form.tipo_comprobante === "RECIBO"
                        ? "🧾 Crear CAI Recibo"
                        : "🏛️ Crear CAI Factura SAR"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal precio dólar ─────────────────────────────────────────────── */}
      <PrecioDolarModal
        open={showPrecioModal}
        onClose={() => setShowPrecioModal(false)}
      />
    </div>
  );
}
