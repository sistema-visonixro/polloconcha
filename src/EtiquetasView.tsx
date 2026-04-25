import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import {
  ChevronLeftIcon,
  ScaleIcon,
  PlusIcon,
  TrashIcon,
  EyeIcon,
  CogIcon,
} from "@heroicons/react/24/outline";

interface EtiquetasViewProps {
  onBack: () => void;
}

interface ProductoDemo {
  id: string;
  nombre: string;
  precio: number;
  cantidad: number;
}

const EtiquetasView: React.FC<EtiquetasViewProps> = ({ onBack }) => {
  // Estados principales
  const [padding, setPadding] = useState(
    () => localStorage.getItem("etiqueta_padding") || "8",
  );
  const [clienteDemo, setClienteDemo] = useState("Cliente de ejemplo");
  const [productosDemo, setProductosDemo] = useState<ProductoDemo[]>([
    { id: "1", nombre: "Pollo Asado", precio: 120, cantidad: 1 },
    { id: "2", nombre: "Papas Fritas", precio: 45, cantidad: 2 },
  ]);
  const [comanda, setComanda] = useState(
    () => localStorage.getItem("etiqueta_comanda") || "",
  );
  const [recibo, setRecibo] = useState(
    () => localStorage.getItem("etiqueta_recibo") || "",
  );
  const [ancho, setAncho] = useState(
    () => localStorage.getItem("etiqueta_ancho") || "58",
  );
  const [alto, setAlto] = useState(
    () => localStorage.getItem("etiqueta_alto") || "40",
  );
  const [fontSize, setFontSize] = useState(
    () => localStorage.getItem("etiqueta_fontSize") || "14",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  // Cargar configuración desde Supabase
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data, error } = await supabase
          .from("etiquetas_config")
          .select("*")
          .eq("nombre", "default")
          .single();

        if (data && !error) {
          setComanda(data.etiqueta_comanda || "");
          setRecibo(data.etiqueta_recibo || "");
          setAncho(data.etiqueta_ancho?.toString() || "58");
          setAlto(data.etiqueta_alto?.toString() || "40");
          setFontSize(data.etiqueta_fontsize?.toString() || "14");
          setPadding(data.etiqueta_padding?.toString() || "8");
        }
      } catch (error) {
        console.error("Error cargando configuración:", error);
      }
    };
    fetchConfig();
  }, []);

  // Funciones para productos demo
  const handleDemoChange = (
    index: number,
    field: keyof ProductoDemo,
    value: string | number,
  ) => {
    setProductosDemo((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [field]:
          field === "cantidad" || field === "precio" ? Number(value) : value,
      };
      return copy;
    });
  };

  const handleAddDemo = () => {
    setProductosDemo((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        nombre: "Nuevo producto",
        precio: 0,
        cantidad: 1,
      },
    ]);
  };

  const handleRemoveDemo = (index: number) => {
    setProductosDemo((prev) => prev.filter((_, i) => i !== index));
  };

  // Función para guardar configuración
  const handleSave = async () => {
    setIsSaving(true);

    localStorage.setItem("etiqueta_padding", padding);
    localStorage.setItem("etiqueta_comanda", comanda);
    localStorage.setItem("etiqueta_recibo", recibo);
    localStorage.setItem("etiqueta_ancho", ancho);
    localStorage.setItem("etiqueta_alto", alto);
    localStorage.setItem("etiqueta_fontSize", fontSize);

    // Mostrar éxito inmediatamente (localStorage ya guardó)
    showNotification("Configuración guardada correctamente", "success");

    // Sincronizar con Supabase en segundo plano (no bloqueante)
    try {
      await supabase.from("etiquetas_config").upsert({
        nombre: "default",
        etiqueta_comanda: comanda,
        etiqueta_recibo: recibo,
        etiqueta_ancho: Number(ancho),
        etiqueta_alto: Number(alto),
        etiqueta_fontsize: Number(fontSize),
        etiqueta_padding: Number(padding),
        actualizado: new Date().toISOString(),
      });
    } catch {
      console.warn(
        "[EtiquetasView] No se pudo sincronizar con Supabase (offline)",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Función para mostrar notificaciones
  const showNotification = (message: string, type: "success" | "error") => {
    const notification = document.createElement("div");
    notification.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === "success" ? "#10b981" : "#ef4444"};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        font-weight: 500;
        max-width: 300px;
        transform: translateX(400px);
        transition: transform 0.3s ease;
      ">
        ${message}
      </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.transform = "translateX(0)";
    }, 100);

    setTimeout(() => {
      notification.style.transform = "translateX(400px)";
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  };

  // Calcular total de productos
  const total = productosDemo.reduce(
    (sum, p) => sum + p.precio * p.cantidad,
    0,
  );

  return (
    <div
      className="admin-panel-enterprise"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
        fontFamily:
          '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: "hidden",
        zIndex: 9999,
      }}
    >
      <style>{`
        * {
          box-sizing: border-box;
        }
        .glass-effect {
          background: rgba(31, 41, 55, 0.8);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .input-field {
          background: #374151;
          border: 1px solid #4b5563;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 14px;
          color: #e5e7eb;
          transition: all 0.2s ease;
          width: 100%;
        }
        .input-field:focus {
          outline: none;
          border-color: #60a5fa;
          box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.2);
          transform: translateY(-1px);
        }
        .btn-primary {
          background: linear-gradient(135deg, #60a5fa 0%, #2563eb 100%);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 12px 20px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(96, 165, 250, 0.3);
        }
        .btn-primary:disabled {
          background: #4b5563;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        .btn-secondary {
          background: rgba(255, 255, 255, 0.05);
          color: #e5e7eb;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 8px 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: #60a5fa;
        }
        .btn-danger {
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 4px 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .btn-danger:hover {
          background: #dc2626;
        }
        .card {
          background: #1f2937;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
          overflow: hidden;
        }
        .section-header {
          background: linear-gradient(135deg, #60a5fa 0%, #2563eb 100%);
          color: white;
          padding: 16px 20px;
          margin: 0;
          font-weight: 700;
          font-size: 16px;
        }
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          padding: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .label {
          font-weight: 600;
          color: #d1d5db;
          font-size: 13px;
        }
        .preview-container {
          background: #2d3748;
          border: 2px dashed #4b5563;
          border-radius: 12px;
          padding: 20px;
          margin: 20px;
        }
        .etiqueta-preview {
          background: white;
          border: 2px solid #10b981;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        .productos-list {
          max-height: 200px;
          overflow-y: auto;
          border: 1px solid #4b5563;
          border-radius: 8px;
          padding: 12px;
          background: #374151;
        }
        .producto-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border-radius: 6px;
          margin-bottom: 8px;
          background: #4b5563;
        }
        .producto-input {
          flex: 1;
          padding: 6px 8px;
          border: 1px solid #6b7280;
          border-radius: 6px;
          font-size: 13px;
          background: #374151;
          color: #e5e7eb;
        }
        .producto-input:focus {
          outline: none;
          border-color: #60a5fa;
          box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
        }
        .total-display {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          padding: 10px 14px;
          border-radius: 8px;
          font-weight: 600;
          text-align: right;
          margin-top: 12px;
        }
        @media (max-width: 768px) {
          .form-grid {
            grid-template-columns: 1fr;
            gap: 12px;
            padding: 16px;
          }
        }
        .productos-list::-webkit-scrollbar {
          width: 6px;
        }
        .productos-list::-webkit-scrollbar-track {
          background: #374151;
          border-radius: 3px;
        }
        .productos-list::-webkit-scrollbar-thumb {
          background: #6b7280;
          border-radius: 3px;
        }
        .productos-list::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header */}
      <div
        className="glass-effect"
        style={{
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <button
          className="btn-secondary"
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <ChevronLeftIcon width={20} height={20} />
          Volver
        </button>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <CogIcon width={24} height={24} style={{ color: "#60a5fa" }} />
          <h1
            style={{
              color: "#e5e7eb",
              fontSize: "20px",
              fontWeight: "700",
              margin: 0,
            }}
          >
            Configuración de Etiquetas
          </h1>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          height: "calc(100vh - 72px)",
          overflow: "hidden",
        }}
      >
        {/* Panel de Configuración */}
        <div
          style={{
            width: "50%",
            padding: "20px",
            overflowY: "auto",
            background: "rgba(31, 41, 55, 0.2)",
          }}
        >
          <div
            className="card"
            style={{ maxWidth: "480px", marginBottom: "20px" }}
          >
            <h2 className="section-header">Configuración General</h2>
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Texto Comanda</label>
                <input
                  type="text"
                  value={comanda}
                  onChange={(e) => setComanda(e.target.value)}
                  placeholder="Ej: Comanda #123"
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label className="label">Texto Recibo</label>
                <input
                  type="text"
                  value={recibo}
                  onChange={(e) => setRecibo(e.target.value)}
                  placeholder="Ej: Recibo"
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label className="label">Ancho (mm)</label>
                <input
                  type="number"
                  min={30}
                  max={80}
                  value={ancho}
                  onChange={(e) => setAncho(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label className="label">Alto (mm)</label>
                <input
                  type="number"
                  min={20}
                  max={100}
                  value={alto}
                  onChange={(e) => setAlto(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label className="label">Tamaño Fuente (px)</label>
                <input
                  type="number"
                  min={8}
                  max={32}
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label className="label">Padding (px)</label>
                <input
                  type="number"
                  min={0}
                  max={32}
                  value={padding}
                  onChange={(e) => setPadding(e.target.value)}
                  className="input-field"
                />
              </div>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary"
            style={{ width: "100%", padding: "12px", fontSize: "14px" }}
          >
            {isSaving ? (
              <>
                <div
                  style={{
                    width: "16px",
                    height: "16px",
                    border: "2px solid white",
                    borderTop: "2px solid transparent",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    marginRight: "8px",
                  }}
                />
                Guardando...
              </>
            ) : (
              <>
                <ScaleIcon width={18} height={18} />
                Guardar Configuración
              </>
            )}
          </button>
        </div>

        {/* Panel de Vista Previa */}
        <div
          style={{
            width: "50%",
            padding: "20px",
            overflowY: "auto",
            background: "rgba(31, 41, 55, 0.2)",
          }}
        >
          <div className="card" style={{ marginBottom: "20px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                background: "rgba(96, 165, 250, 0.1)",
              }}
            >
              <h2
                className="section-header"
                style={{
                  background: "transparent",
                  color: "#e5e7eb",
                  margin: 0,
                  padding: 0,
                }}
              >
                Vista Previa
              </h2>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="btn-secondary"
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <EyeIcon width={16} height={16} />
                {showPreview ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            {showPreview && (
              <>
                <div className="form-group" style={{ padding: "0 20px 20px" }}>
                  <label className="label">Nombre del Cliente</label>
                  <input
                    type="text"
                    value={clienteDemo}
                    onChange={(e) => setClienteDemo(e.target.value)}
                    placeholder="Ingresa el nombre del cliente"
                    className="input-field"
                  />
                </div>
                <div className="productos-list">
                  <div
                    style={{
                      marginBottom: "10px",
                      fontWeight: "600",
                      color: "#d1d5db",
                    }}
                  >
                    Productos de ejemplo:
                  </div>
                  {productosDemo.map((producto, index) => (
                    <div key={producto.id} className="producto-item">
                      <input
                        type="text"
                        value={producto.nombre}
                        onChange={(e) =>
                          handleDemoChange(index, "nombre", e.target.value)
                        }
                        placeholder="Nombre del producto"
                        className="producto-input"
                        style={{ flex: "2" }}
                      />
                      <input
                        type="number"
                        value={producto.precio}
                        min={0}
                        onChange={(e) =>
                          handleDemoChange(index, "precio", e.target.value)
                        }
                        placeholder="Precio"
                        className="producto-input"
                        style={{ width: "80px" }}
                      />
                      <input
                        type="number"
                        value={producto.cantidad}
                        min={1}
                        onChange={(e) =>
                          handleDemoChange(index, "cantidad", e.target.value)
                        }
                        placeholder="Cant."
                        className="producto-input"
                        style={{ width: "60px" }}
                      />
                      <button
                        onClick={() => handleRemoveDemo(index)}
                        className="btn-danger"
                        style={{ flexShrink: 0 }}
                      >
                        <TrashIcon width={12} height={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={handleAddDemo}
                    className="btn-primary"
                    style={{
                      width: "100%",
                      marginTop: "8px",
                      padding: "8px 12px",
                      fontSize: "13px",
                    }}
                  >
                    <PlusIcon width={16} height={16} />
                    Agregar Producto
                  </button>
                </div>
                <div className="total-display">Total: L {total.toFixed(2)}</div>
                <div className="preview-container">
                  <div
                    className="etiqueta-preview"
                    style={{
                      width: `${ancho}mm`,
                      height: `${alto}mm`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "flex-start",
                      fontSize: `${fontSize}px`,
                      color: "#1f2937",
                      padding: `${padding}px`,
                      fontFamily: '"Inter", sans-serif',
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        textAlign: "center",
                        fontWeight: "700",
                        marginBottom: "8px",
                        fontSize: `${parseInt(fontSize) * 1.1}px`,
                      }}
                    >
                      {comanda || "Comanda"}
                    </div>
                    <div
                      style={{
                        width: "100%",
                        textAlign: "center",
                        fontWeight: "500",
                        marginBottom: "12px",
                        color: "#374151",
                      }}
                    >
                      {clienteDemo}
                    </div>
                    <div style={{ width: "100%", flex: 1, overflow: "hidden" }}>
                      {productosDemo.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "6px",
                            paddingBottom: "4px",
                            borderBottom: "1px dashed #e5e7eb",
                            fontSize: `${parseInt(fontSize) * 0.9}px`,
                          }}
                        >
                          <span style={{ fontWeight: "600" }}>{p.nombre}</span>
                          <span style={{ fontWeight: "500", color: "#374151" }}>
                            L {p.precio.toFixed(2)} x {p.cantidad}
                          </span>
                        </div>
                      ))}
                    </div>
                    {total > 0 && (
                      <div
                        style={{
                          width: "100%",
                          textAlign: "right",
                          fontWeight: "700",
                          marginTop: "8px",
                          paddingTop: "8px",
                          borderTop: "2px solid #10b981",
                          fontSize: `${parseInt(fontSize) * 1.1}px`,
                        }}
                      >
                        Total: L {total.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EtiquetasView;
