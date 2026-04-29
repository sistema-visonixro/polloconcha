import { useState } from "react";
import { supabase } from "./supabaseClient";
import { STORE, deleteById, openLocalDB } from "./utils/localDB";
import { registrarDevoluciono } from "./services/devolucionesService";

export interface Factura {
  id: number;
  fecha_hora: string;
  factura: string;
  cai: string;
  cajero: string;
  caja?: string;
  sub_total: string;
  isv_15: string;
  isv_18: string;
  total: string;
  productos: string;
  cliente: string;
  es_donacion?: boolean;
  tipo_orden?: string;
  tipo?: string;
  efectivo?: number | string;
  tarjeta?: number | string;
  transferencia?: number | string;
  dolares?: number | string;
  dolares_usd?: number | string;
  delivery?: number | string;
  cambio?: number | string;
}

interface DetalleFacturaModalProps {
  factura: Factura | null;
  onClose: () => void;
  onRefresh: () => void;
}

export default function DetalleFacturaModal({
  factura,
  onClose,
  onRefresh,
}: DetalleFacturaModalProps) {
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<Factura> | null>(null);
  const [saving, setSaving] = useState(false);
  const [devolucionMode, setDevolucionMode] = useState(false);
  const [devolucionMonto, setDevolucionMonto] = useState("");
  const [devolucionMotivo, setDevolucionMotivo] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!factura) return null;

  const handleEdit = () => {
    setEditMode(true);
    setEditData({ ...factura });
  };

  const handleCancel = () => {
    setEditMode(false);
    setEditData(null);
  };

  const handleSave = async () => {
    if (!editData) return;
    setSaving(true);
    try {
      // Actualizar en Supabase
      const { error: supabaseError } = await supabase
        .from("ventas")
        .update(editData)
        .eq("id", factura.id);

      if (!supabaseError) {
        // Actualizar en IndexedDB
        await (async () => {
          const db = await openLocalDB();
          const tx = db
            .transaction([STORE.VENTAS], "readwrite")
            .objectStore(STORE.VENTAS);
          tx.put(editData);
        })();
        onRefresh();
        setEditMode(false);
        setEditData(null);
      } else {
        // Si falla online, solo guardar en IndexedDB
        const db = await openLocalDB();
        const tx = db
          .transaction([STORE.VENTAS], "readwrite")
          .objectStore(STORE.VENTAS);
        tx.put(editData);
        onRefresh();
        setEditMode(false);
        setEditData(null);
      }
    } catch (error) {
      console.error("Error al guardar:", error);
      // Fallback a IndexedDB
      try {
        const db = await openLocalDB();
        const tx = db
          .transaction([STORE.VENTAS], "readwrite")
          .objectStore(STORE.VENTAS);
        tx.put(editData);
        onRefresh();
        setEditMode(false);
        setEditData(null);
      } catch (dbError) {
        console.error("Error al guardar en IndexedDB:", dbError);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      // Eliminar de Supabase
      const { error: deleteError } = await supabase
        .from("ventas")
        .delete()
        .eq("id", factura.id);

      if (!deleteError) {
        // Éxito en Supabase, también eliminar de IndexedDB
        try {
          await deleteById(STORE.VENTAS, factura.id);
        } catch (error) {
          console.error("Error al eliminar de IndexedDB:", error);
        }
      } else {
        // Si falla en Supabase, solo marcar como eliminado localmente
        try {
          const db = await openLocalDB();
          const tx = db
            .transaction([STORE.VENTAS], "readwrite")
            .objectStore(STORE.VENTAS);
          const updated = { ...factura, estado: "ELIMINADO" };
          tx.put(updated);
        } catch (error) {
          console.error("Error al guardar eliminación en IndexedDB:", error);
        }
      }

      onRefresh();
      onClose();
    } catch (error) {
      console.error("Error al eliminar:", error);
      alert("Error al eliminar la factura");
    } finally {
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDevoluciono = async () => {
    if (!devolucionMonto || parseFloat(devolucionMonto) <= 0) {
      alert("Ingrese un monto válido para la devolución");
      return;
    }

    if (parseFloat(devolucionMonto) > parseFloat(factura.total)) {
      alert(
        `El monto debe ser menor o igual a L ${parseFloat(factura.total).toFixed(2)}`,
      );
      return;
    }

    setSaving(true);
    try {
      const montoDevolucion = parseFloat(devolucionMonto);
      const esDevolucionTotal = montoDevolucion >= parseFloat(factura.total);

      // Crear registro de devolución
      const devolucionData = {
        factura_id: factura.id,
        numero_factura: factura.factura,
        monto: montoDevolucion,
        motivo: devolucionMotivo,
        tipo: (esDevolucionTotal ? "TOTAL" : "PARCIAL") as "TOTAL" | "PARCIAL",
        fecha_hora: new Date().toISOString(),
        usuario: factura.cajero,
      };

      // Registrar devolución usando el servicio (offline-first)
      const resultado = await registrarDevoluciono(devolucionData);

      if (resultado.success) {
        // Actualizar estado en factura si es devolución total
        if (esDevolucionTotal) {
          try {
            await supabase
              .from("ventas")
              .update({ tipo_orden: "DEVUELTA" })
              .eq("id", factura.id);
          } catch (error) {
            // Si falla, guardar localmente para sincronizar después
            const db = await openLocalDB();
            const tx = db
              .transaction([STORE.VENTAS], "readwrite")
              .objectStore(STORE.VENTAS);
            tx.put({ ...factura, tipo_orden: "DEVUELTA" });
          }
        }

        onRefresh();
        setDevolucionMode(false);
        setDevolucionMonto("");
        setDevolucionMotivo("");
        alert(resultado.message);
      } else {
        alert(resultado.message);
      }
    } catch (error) {
      console.error("Error al registrar devolución:", error);
      alert("Error al registrar la devolución");
    } finally {
      setSaving(false);
    }
  };

  const modalStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    background: "rgba(0, 0, 0, 0.6)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  };

  const contentStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 20,
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
    padding: "40px",
    maxWidth: 900,
    maxHeight: "85vh",
    overflow: "auto",
    position: "relative",
    width: "100%",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "32px",
    paddingBottom: "20px",
    borderBottom: "2px solid #e2e8f0",
  };

  const titleStyle: React.CSSProperties = {
    color: "#0b4f9a",
    fontWeight: 900,
    fontSize: 32,
    margin: 0,
    lineHeight: 1,
  };

  const subtitleStyle: React.CSSProperties = {
    color: "#64748b",
    fontSize: 14,
    marginTop: "8px",
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: "32px",
  };

  const sectionTitleStyle: React.CSSProperties = {
    color: "#1976d2",
    fontWeight: 700,
    fontSize: 18,
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "20px",
  };

  const fieldItemStyle: React.CSSProperties = {
    background: "#f8fafc",
    padding: "16px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
  };

  const fieldLabelStyle: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: "8px",
  };

  const fieldValueStyle: React.CSSProperties = {
    fontSize: "16px",
    fontWeight: 600,
    color: "#0b4f9a",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    fontSize: "14px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontFamily: "inherit",
    marginTop: "8px",
  };

  const buttonGroupStyle: React.CSSProperties = {
    display: "flex",
    gap: "12px",
    justifyContent: "flex-end",
    marginTop: "32px",
    paddingTop: "20px",
    borderTop: "2px solid #e2e8f0",
    flexWrap: "wrap",
  };

  const btnPrimaryStyle: React.CSSProperties = {
    padding: "10px 24px",
    background: "#1976d2",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    transition: "background 0.2s",
  };

  const btnSecondaryStyle: React.CSSProperties = {
    padding: "10px 24px",
    background: "#e2e8f0",
    color: "#0b4f9a",
    border: "none",
    borderRadius: "8px",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    transition: "background 0.2s",
  };

  const btnDangerStyle: React.CSSProperties = {
    padding: "10px 24px",
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    transition: "background 0.2s",
  };

  const btnWarningStyle: React.CSSProperties = {
    padding: "10px 24px",
    background: "#f97316",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    transition: "background 0.2s",
  };

  const closeButtonStyle: React.CSSProperties = {
    position: "absolute",
    top: "20px",
    right: "20px",
    background: "#e2e8f0",
    color: "#64748b",
    border: "none",
    borderRadius: "8px",
    width: "40px",
    height: "40px",
    fontSize: "24px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const totalBlockStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, #1976d2 0%, #0b4f9a 100%)",
    color: "#fff",
    padding: "24px",
    borderRadius: "12px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "20px",
    marginBottom: "32px",
  };

  const totalItemStyle: React.CSSProperties = {
    textAlign: "center",
  };

  const totalLabelStyle: React.CSSProperties = {
    fontSize: "12px",
    opacity: 0.9,
    marginBottom: "4px",
  };

  const totalAmountStyle: React.CSSProperties = {
    fontSize: "24px",
    fontWeight: 900,
  };

  const productsListStyle: React.CSSProperties = {
    background: "#f8fafc",
    padding: "16px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
  };

  const productItemStyle: React.CSSProperties = {
    padding: "12px",
    background: "#fff",
    borderRadius: "8px",
    marginBottom: "8px",
    borderLeft: "4px solid #1976d2",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "14px",
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        <button style={closeButtonStyle} onClick={onClose}>
          ✕
        </button>

        {/* MODO VISUALIZACIÓN */}
        {!editMode && !devolucionMode && (
          <>
            {/* Header */}
            <div style={headerStyle}>
              <div>
                <h1 style={titleStyle}>📄 Factura #{factura.factura}</h1>
                <div style={subtitleStyle}>
                  {factura.fecha_hora?.replace("T", " ").slice(0, 19)}
                </div>
              </div>
            </div>

            {/* Total Block */}
            <div style={totalBlockStyle}>
              <div style={totalItemStyle}>
                <div style={totalLabelStyle}>SUBTOTAL</div>
                <div style={totalAmountStyle}>
                  L {parseFloat(factura.sub_total).toFixed(2)}
                </div>
              </div>
              <div style={totalItemStyle}>
                <div style={totalLabelStyle}>ISV (15% + 18%)</div>
                <div style={totalAmountStyle}>
                  L{" "}
                  {(
                    parseFloat(factura.isv_15) + parseFloat(factura.isv_18)
                  ).toFixed(2)}
                </div>
              </div>
              <div style={totalItemStyle}>
                <div style={totalLabelStyle}>TOTAL</div>
                <div style={totalAmountStyle}>
                  L {parseFloat(factura.total).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Información General */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>ℹ️ Información General</div>
              <div style={gridStyle}>
                <div style={fieldItemStyle}>
                  <div style={fieldLabelStyle}>Cliente</div>
                  <div style={fieldValueStyle}>{factura.cliente || "---"}</div>
                </div>
                <div style={fieldItemStyle}>
                  <div style={fieldLabelStyle}>Número de Factura</div>
                  <div style={fieldValueStyle}>{factura.factura}</div>
                </div>
                <div style={fieldItemStyle}>
                  <div style={fieldLabelStyle}>CAI</div>
                  <div
                    style={{
                      ...fieldValueStyle,
                      fontSize: "12px",
                      wordBreak: "break-all",
                    }}
                  >
                    {factura.cai}
                  </div>
                </div>
                <div style={fieldItemStyle}>
                  <div style={fieldLabelStyle}>Cajero</div>
                  <div style={fieldValueStyle}>{factura.cajero}</div>
                </div>
                <div style={fieldItemStyle}>
                  <div style={fieldLabelStyle}>Caja</div>
                  <div style={fieldValueStyle}>{factura.caja || "---"}</div>
                </div>
                <div style={fieldItemStyle}>
                  <div style={fieldLabelStyle}>Tipo de Orden</div>
                  <div style={fieldValueStyle}>
                    {factura.tipo_orden || "---"}
                  </div>
                </div>
              </div>
            </div>

            {/* Métodos de Pago */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>💳 Métodos de Pago</div>
              <div style={gridStyle}>
                {parseFloat(String(factura.efectivo ?? 0)) > 0 && (
                  <div style={fieldItemStyle}>
                    <div style={fieldLabelStyle}>Efectivo</div>
                    <div style={fieldValueStyle}>
                      L {parseFloat(String(factura.efectivo)).toFixed(2)}
                    </div>
                  </div>
                )}
                {parseFloat(String(factura.tarjeta ?? 0)) > 0 && (
                  <div style={fieldItemStyle}>
                    <div style={fieldLabelStyle}>Tarjeta</div>
                    <div style={fieldValueStyle}>
                      L {parseFloat(String(factura.tarjeta)).toFixed(2)}
                    </div>
                  </div>
                )}
                {parseFloat(String(factura.transferencia ?? 0)) > 0 && (
                  <div style={fieldItemStyle}>
                    <div style={fieldLabelStyle}>Transferencia</div>
                    <div style={fieldValueStyle}>
                      L {parseFloat(String(factura.transferencia)).toFixed(2)}
                    </div>
                  </div>
                )}
                {parseFloat(String(factura.dolares ?? 0)) > 0 && (
                  <div style={fieldItemStyle}>
                    <div style={fieldLabelStyle}>Dólares</div>
                    <div style={fieldValueStyle}>
                      L {parseFloat(String(factura.dolares)).toFixed(2)} (USD{" "}
                      {parseFloat(String(factura.dolares_usd)).toFixed(2)})
                    </div>
                  </div>
                )}
                {parseFloat(String(factura.delivery ?? 0)) > 0 && (
                  <div style={fieldItemStyle}>
                    <div style={fieldLabelStyle}>Delivery</div>
                    <div style={fieldValueStyle}>
                      L {parseFloat(String(factura.delivery)).toFixed(2)}
                    </div>
                  </div>
                )}
                {parseFloat(String(factura.cambio ?? 0)) > 0 && (
                  <div style={fieldItemStyle}>
                    <div style={fieldLabelStyle}>Cambio</div>
                    <div style={fieldValueStyle}>
                      L {parseFloat(String(factura.cambio)).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Productos */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>📦 Productos</div>
              <div style={productsListStyle}>
                {(() => {
                  try {
                    const arr = JSON.parse(factura.productos);
                    if (Array.isArray(arr) && arr.length > 0) {
                      return arr.map((p: any, idx: number) => (
                        <div key={idx} style={productItemStyle}>
                          <div>
                            <div style={{ fontWeight: 700, color: "#0b4f9a" }}>
                              {p.nombre}
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>
                              Cantidad: {p.cantidad}
                            </div>
                          </div>
                          <div style={{ fontWeight: 700, color: "#1976d2" }}>
                            L {parseFloat(p.precio).toFixed(2)}
                          </div>
                        </div>
                      ));
                    }
                  } catch {
                    return null;
                  }
                  return <div style={{ color: "#64748b" }}>Sin productos</div>;
                })()}
              </div>
            </div>

            {/* Botones de Acción */}
            <div style={buttonGroupStyle}>
              {showDeleteConfirm ? (
                <>
                  <button
                    style={{ ...btnSecondaryStyle, background: "#f1f5f9" }}
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    style={{ ...btnDangerStyle, background: "#991b1b" }}
                    onClick={handleDelete}
                    disabled={saving}
                  >
                    {saving ? "Eliminando..." : "Confirmar Eliminación"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    style={btnSecondaryStyle}
                    onClick={onClose}
                    disabled={saving}
                  >
                    Cerrar
                  </button>
                  <button
                    style={btnWarningStyle}
                    onClick={() => setDevolucionMode(true)}
                    disabled={saving}
                  >
                    🔄 Devolución
                  </button>
                  <button
                    style={btnPrimaryStyle}
                    onClick={handleEdit}
                    disabled={saving}
                  >
                    ✏️ Editar
                  </button>
                  <button
                    style={btnDangerStyle}
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={saving}
                  >
                    🗑️ Eliminar
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* MODO EDICIÓN */}
        {editMode && editData && (
          <>
            <div style={headerStyle}>
              <h1 style={titleStyle}>✏️ Editar Factura</h1>
            </div>

            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Información Básica</div>
              <div style={gridStyle}>
                <div>
                  <label style={fieldLabelStyle}>Cliente</label>
                  <input
                    type="text"
                    style={inputStyle}
                    value={editData.cliente || ""}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        cliente: e.target.value,
                      })
                    }
                    placeholder="Nombre del cliente"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Tipo de Orden</label>
                  <select
                    style={inputStyle}
                    value={editData.tipo_orden || ""}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        tipo_orden: e.target.value,
                      })
                    }
                  >
                    <option value="">Seleccionar...</option>
                    <option value="normal">Normal</option>
                    <option value="delivery">Delivery</option>
                    <option value="retiro">Retiro</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Montos Financieros</div>
              <div style={gridStyle}>
                <div>
                  <label style={fieldLabelStyle}>Sub Total</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.sub_total || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        sub_total: e.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>ISV 15%</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.isv_15 || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        isv_15: e.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>ISV 18%</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.isv_18 || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        isv_18: e.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Total</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.total || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        total: e.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Métodos de Pago</div>
              <div style={gridStyle}>
                <div>
                  <label style={fieldLabelStyle}>Efectivo</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.efectivo || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        efectivo: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Tarjeta</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.tarjeta || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        tarjeta: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Transferencia</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.transferencia || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        transferencia: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Dólares (L)</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.dolares || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        dolares: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Dólares USD</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.dolares_usd || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        dolares_usd: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Delivery</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.delivery || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        delivery: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Cambio</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={editData.cambio || "0"}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        cambio: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            <div
              style={{
                background: "#eef2ff",
                padding: "16px",
                borderRadius: "8px",
                border: "1px solid #c7d2fe",
                marginBottom: "20px",
              }}
            >
              <div
                style={{ fontSize: "12px", fontWeight: 700, color: "#3730a3" }}
              >
                ℹ️ Nota Importante
              </div>
              <div
                style={{ fontSize: "13px", color: "#4f46e5", marginTop: "8px" }}
              >
                Los cambios serán guardados en IndexedDB inmediatamente y
                sincronizados a Supabase cuando restablezca la conexión a
                internet.
              </div>
            </div>

            <div style={buttonGroupStyle}>
              <button
                style={btnSecondaryStyle}
                onClick={handleCancel}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                style={btnPrimaryStyle}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Guardando..." : "💾 Guardar Cambios"}
              </button>
            </div>
          </>
        )}

        {/* MODO DEVOLUCIÓN */}
        {devolucionMode && (
          <>
            <div style={headerStyle}>
              <h1 style={titleStyle}>🔄 Registrar Devolución</h1>
            </div>

            <div style={sectionStyle}>
              <div style={fieldItemStyle}>
                <div style={fieldLabelStyle}>Factura</div>
                <div style={fieldValueStyle}>#{factura.factura}</div>
              </div>
              <div style={{ ...fieldItemStyle, marginTop: "16px" }}>
                <div style={fieldLabelStyle}>Total Factura</div>
                <div style={fieldValueStyle}>
                  L {parseFloat(factura.total).toFixed(2)}
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Detalles de la Devolución</div>
              <div style={gridStyle}>
                <div>
                  <label style={fieldLabelStyle}>Monto a Devolver</label>
                  <input
                    type="number"
                    style={inputStyle}
                    step="0.01"
                    value={devolucionMonto}
                    onChange={(e) => setDevolucionMonto(e.target.value)}
                    placeholder={`Máximo: L ${parseFloat(factura.total).toFixed(2)}`}
                    max={parseFloat(factura.total)}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Motivo</label>
                  <select
                    style={inputStyle}
                    value={devolucionMotivo}
                    onChange={(e) => setDevolucionMotivo(e.target.value)}
                  >
                    <option value="">Seleccionar motivo...</option>
                    <option value="error_operador">Error del Operador</option>
                    <option value="producto_defectuoso">
                      Producto Defectuoso
                    </option>
                    <option value="cambio">Cambio de Producto</option>
                    <option value="cliente_solicitud">
                      Solicitud del Cliente
                    </option>
                    <option value="error_precio">Error de Precio</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>
            </div>

            <div
              style={{
                background: "#fef2f2",
                padding: "16px",
                borderRadius: "8px",
                border: "1px solid #fecaca",
                marginBottom: "20px",
              }}
            >
              <div
                style={{ fontSize: "12px", fontWeight: 700, color: "#991b1b" }}
              >
                ⚠️ Nota Importante
              </div>
              <div
                style={{ fontSize: "13px", color: "#7c2d12", marginTop: "8px" }}
              >
                Esta acción será sincronizada automáticamente con Supabase
                cuando restablezca la conexión a internet.
              </div>
            </div>

            <div style={buttonGroupStyle}>
              <button
                style={btnSecondaryStyle}
                onClick={() => setDevolucionMode(false)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                style={btnWarningStyle}
                onClick={handleDevoluciono}
                disabled={saving || !devolucionMonto || !devolucionMotivo}
              >
                {saving ? "Registrando..." : "✓ Registrar Devolución"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
