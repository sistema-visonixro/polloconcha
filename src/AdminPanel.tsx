import type { FC } from "react";

type ViewType =
  | "home"
  | "puntoDeVenta"
  | "admin"
  | "usuarios"
  | "inventario"
  | "movimientosInventario"
  | "cai"
  | "resultados"
  | "gastos"
  | "facturasEmitidas"
  | "apertura"
  | "resultadosCaja"
  | "cajaOperada"
  | "cierreadmin"
  | "etiquetas"
  | "recibo"
  | "datosNegocio"
  | "gananciasNetas"
  | "creditosPendientes"
  | "proveedores"
  | "donacionesMensuales"
  | "impresoras"
  | "configuraciones"
  | "facturacionSAR";

const cards: {
  label: string;
  icon: string;
  view: ViewType;
  color: string;
  subtitle: string;
}[] = [
  {
    label: "Gestión de Usuarios",
    icon: "👥",
    view: "usuarios",
    color: "#1e88e5",
    subtitle: "Roles y permisos",
  },
  {
    label: "Control de Inventario",
    icon: "📦",
    view: "inventario",
    color: "#2e7d32",
    subtitle: "Stock y productos",
  },
  {
    label: "Movimientos y Producción",
    icon: "🏭",
    view: "movimientosInventario",
    color: "#1565c0",
    subtitle: "Kardex, recetas y lotes",
  },
  {
    label: "CAI y Facturación",
    icon: "🧾",
    view: "cai",
    color: "#f57c00",
    subtitle: "Documentos fiscales",
  },
  {
    label: "Facturación SAR",
    icon: "🏛️",
    view: "facturacionSAR",
    color: "#1a237e",
    subtitle: "Declaración mensual SAR",
  },
  {
    label: "Reporte de Ventas",
    icon: "📊",
    view: "resultados",
    color: "#c62828",
    subtitle: "Análisis de ventas",
  },
  {
    label: "Registro de Gastos",
    icon: "💰",
    view: "gastos",
    color: "#6a1b9a",
    subtitle: "Control presupuestario",
  },
  {
    label: "Cierre de Caja",
    icon: "🔒",
    view: "cierreadmin",
    color: "#f57c00",
    subtitle: "Conciliación diaria",
  },
  {
    label: "Mis Datos",
    icon: "🏪",
    view: "datosNegocio",
    color: "#00897b",
    subtitle: "Información del negocio",
  },
  {
    label: "Ganancias Netas",
    icon: "📈",
    view: "gananciasNetas",
    color: "#0f766e",
    subtitle: "Rentabilidad y margen",
  },
  {
    label: "Créditos Pendientes",
    icon: "💳",
    view: "creditosPendientes",
    color: "#7c3aed",
    subtitle: "Cuentas por cobrar",
  },
  {
    label: "Proveedores y CxP",
    icon: "🏭",
    view: "proveedores",
    color: "#0f766e",
    subtitle: "Cuentas por pagar",
  },
  {
    label: "Donaciones Mensuales",
    icon: "🎁",
    view: "donacionesMensuales",
    color: "#7c3aed",
    subtitle: "Platillos regalados",
  },
  {
    label: "Impresoras",
    icon: "🖨️",
    view: "impresoras",
    color: "#0284c7",
    subtitle: "USB recibo y comanda",
  },
  {
    label: "Configuraciones",
    icon: "⚙️",
    view: "configuraciones",
    color: "#475569",
    subtitle: "Reglas del POS",
  },
];

interface AdminPanelProps {
  onSelect: (view: ViewType) => void;
  user: any;
}

import { useState, useEffect } from "react";
import { useDatosNegocio } from "./useDatosNegocio";
import UsuariosView from "./UsuariosView";
import InventarioView from "./InventarioView";
import MovimientosInventarioView from "./MovimientosInventarioView";
import CaiFacturasView from "./CaiFacturasView";
import ResultadosView from "./ResultadosView";
import GastosView from "./GastosView";
import FacturasEmitidasView from "./FacturasEmitidasView";
import CierresAdminView from "./CierresAdminView";
import DatosNegocioView from "./DatosNegocioView";
import GananciasNetasView from "./GananciasNetasView";
import CreditosPendientesView from "./CreditosPendientesView";
import ProveedoresCxPView from "./ProveedoresCxPView";
import DonacionesMensualesView from "./DonacionesMensualesView";
import ImpresorasView from "./ImpresorasView";
import FacturacionSARView from "./FacturacionSARView";
import ConfiguracionesView from "./ConfiguracionesView";

const ADMIN_PANEL_VIEW_KEY = "admin_current_view";
const VALID_ADMIN_VIEWS = new Set<string>([
  "menu",
  "facturasEmitidas",
  ...cards.map((card) => card.view),
]);

const AdminPanel: FC<AdminPanelProps> = (props) => {
  const { user } = props;
  const { datos: datosNegocio } = useDatosNegocio();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );

  const [currentView, setCurrentView] = useState<string>(() => {
    try {
      const savedView = localStorage.getItem(ADMIN_PANEL_VIEW_KEY);
      if (savedView && VALID_ADMIN_VIEWS.has(savedView)) {
        return savedView;
      }
    } catch {
      // ignore localStorage errors
    }
    return "menu";
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    try {
      if (VALID_ADMIN_VIEWS.has(currentView)) {
        localStorage.setItem(ADMIN_PANEL_VIEW_KEY, currentView);
      }
    } catch {
      // ignore localStorage errors
    }
  }, [currentView]);

  useEffect(() => {
    const onResize = () => {
      const desk = window.innerWidth >= 1024;
      setIsDesktop(desk);
      if (desk) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleMenuClick = (view: string) => {
    setCurrentView(view);
    if (!isDesktop) setIsSidebarOpen(false);
  };

  const navIcons: Record<string, React.ReactNode> = {
    menu: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    usuarios: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    inventario: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    movimientosInventario: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
    cai: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    resultados: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    gastos: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
    cierreadmin: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    datosNegocio: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
    gananciasNetas: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    creditosPendientes: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
        <path d="M12 16h.01" strokeWidth="3" />
      </svg>
    ),
    proveedores: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    donacionesMensuales: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 12v10H4V12" />
        <path d="M22 7H2v5h20V7z" />
        <path d="M12 22V7" />
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
      </svg>
    ),
    impresoras: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    ),
    facturacionSAR: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    ),
    configuraciones: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  };

  return (
    <div
      className="admin-panel-enterprise"
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
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
        background: #f8fafc !important;
      }
      :root {
        --primary: #ffffff;
        --secondary: #f8fafc;
        --accent: #3b82f6;
        --text-primary: #0f172a;
        --text-secondary: #64748b;
        --border: #e2e8f0;
        --shadow: 0 4px 20px rgba(0,0,0,0.06);
        --card-color: #3b82f6;
      }

      * { box-sizing: border-box; }

      .admin-panel-enterprise {
        min-height: 100vh;
        background: linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow-x: hidden;
      }
      
      .desktop-admin-layout { 
        box-sizing: border-box; 
        width: 100%; 
        height: 100vh;
        overflow: hidden; 
        display: flex;
        position: relative;
      }
      
      .sidebar {
        width: 260px;
        min-width: 260px;
        height: 100vh;
        overflow-y: auto;
        background: linear-gradient(180deg, #0f1923 0%, #080e14 100%);
        border-right: 1px solid rgba(255,255,255,0.05);
        box-shadow: 2px 0 24px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
        transition: transform 0.38s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.38s ease;
        will-change: transform;
        z-index: 1000;
        position: relative;
      }
      .sidebar::-webkit-scrollbar { width: 4px; }
      .sidebar::-webkit-scrollbar-track { background: transparent; }
      .sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

      .sidebar-header {
        padding: 1.4rem 1.2rem;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        background: rgba(255,255,255,0.02);
      }
      .sidebar-logo {
        display: flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
      }
      .sidebar-logo img, .sidebar-logo > div {
        width: 38px;
        height: 38px;
        border-radius: 9px;
        object-fit: cover;
        flex-shrink: 0;
      }
      .sidebar-title {
        font-size: 0.87rem;
        font-weight: 700;
        color: #f1f5f9;
        line-height: 1.3;
      }
      .sidebar-nav {
        flex: 1;
        padding: 0.75rem 0.6rem;
        overflow-y: auto;
      }
      .sidebar-nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 8px;
        border: none;
        background: transparent;
        cursor: pointer;
        text-align: left;
        width: 100%;
        transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
        margin-bottom: 2px;
        color: rgba(255,255,255,0.52);
      }
      .sidebar-nav-item:hover {
        background: rgba(255,255,255,0.07);
        color: rgba(255,255,255,0.9);
        transform: translateX(2px);
      }
      .sidebar-nav-item.active {
        background: rgba(99,102,241,0.18);
        border-left: 2px solid #818cf8;
        color: #e0e7ff;
        padding-left: 8px;
      }
      .sidebar-nav-icon {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: inherit;
      }
      .sidebar-nav-item.active .sidebar-nav-icon { color: #a5b4fc; }
      .sidebar-nav-text {
        flex: 1;
        min-width: 0;
      }
      .sidebar-nav-label {
        font-size: 0.82rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: inherit;
      }
      .sidebar-nav-item.active .sidebar-nav-label { font-weight: 600; }
      .sidebar-nav-subtitle {
        font-size: 0.67rem;
        color: rgba(255,255,255,0.3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sidebar-footer {
        padding: 0.875rem 0.75rem;
        border-top: 1px solid rgba(255,255,255,0.06);
        background: rgba(255,255,255,0.02);
      }
      .sidebar-logout-btn {
        width: 100%;
        padding: 9px 14px;
        border-radius: 8px;
        background: rgba(239,68,68,0.1);
        color: rgba(252,165,165,0.9);
        border: 1px solid rgba(239,68,68,0.2);
        font-weight: 600;
        font-size: 0.78rem;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        letter-spacing: 0.01em;
      }
      .sidebar-logout-btn:hover {
        background: rgba(239,68,68,0.22);
        color: #fff;
        border-color: rgba(239,68,68,0.4);
        transform: translateY(-1px);
      }
      .mobile-close-btn {
        display: none;
        position: absolute;
        top: 16px;
        right: 14px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer;
        color: rgba(255,255,255,0.65);
        padding: 0;
        z-index: 10;
        width: 30px;
        height: 30px;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: all 0.15s ease;
      }
      .mobile-close-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
      .sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(3px);
        z-index: 999;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.38s ease, visibility 0.38s ease;
      }
      .sidebar-overlay.open {
        opacity: 1;
        visibility: visible;
      }

      .desktop-content { 
        flex: 1;
        height: 100vh;
        overflow-y: auto;
        overflow-x: hidden;
        background: #fafbfc;
        width: 0; 
        display: flex;
        flex-direction: column;
      }
      .desktop-content::-webkit-scrollbar { width: 8px; }
      .desktop-content::-webkit-scrollbar-track { background: #f1f5f9; }
      .desktop-content::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      
      .mobile-header {
        display: none;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.5rem;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border-bottom: 1px solid var(--border);
        box-shadow: 0 2px 12px rgba(0,0,0,0.04);
        position: sticky;
        top: 0;
        z-index: 100;
      }
      
      .mobile-header-left {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .hamburger-btn {
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: #0f172a;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mobile-header-title {
        font-weight: 800;
        color: #0f172a;
        font-size: 1.1rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .mobile-header-logo {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        object-fit: cover;
      }
      
      .view-wrapper {
        flex: 1;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        padding: 1.5rem;
        overflow-x: hidden;
        box-sizing: border-box;
      }

      .main-content {
        max-width: 1460px;
        margin: 0 auto;
      }
      
      .welcome-section {
        margin-bottom: 1.2rem;
        margin-top: 0.2rem;
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      }
      .welcome-title {
        font-size: clamp(1.45rem, 3vw, 2.1rem);
        font-weight: 900;
        color: #fff;
        margin: 0;
        letter-spacing: 0.7px;
      }
      .welcome-hero {
        background: linear-gradient(135deg, #0b4f9a 0%, #1976d2 100%);
        color: #fff;
        padding: 1.4rem 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .welcome-subtitle {
        color: rgba(255,255,255,0.92);
        margin: 6px 0 0 0;
        font-size: 0.86rem;
        font-weight: 600;
      }
      .welcome-pill {
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.35);
        color: #fff;
        padding: 8px 12px;
        border-radius: 20px;
        font-size: 0.76rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .welcome-pill.secondary {
        background: rgba(255,255,255,0.12);
      }
      .welcome-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        background: #fff;
        border-top: 1px solid #dbe2ea;
      }
      .welcome-stat {
        padding: 12px 14px;
        text-align: center;
        border-right: 1px solid #e2e8f0;
      }
      .welcome-stat:last-child {
        border-right: none;
      }
      .welcome-stat-label {
        font-size: 0.68rem;
        color: #64748b;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .welcome-stat-value {
        font-size: 1.2rem;
        color: #0f172a;
        font-weight: 900;
        margin-top: 3px;
      }

      .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1rem;
      }
      .card {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1.1rem 1.15rem;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        box-shadow: 0 2px 10px rgba(0,0,0,0.06);
      }
      .card::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 5px;
        background: var(--card-color);
        border-radius: 20px 20px 0 0;
      }
      .card:hover {
        transform: translateY(-3px);
        box-shadow: 0 10px 24px rgba(0,0,0,0.11);
      }
      .card-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 0.9rem;
      }
      .card-icon {
        width: 46px;
        height: 46px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.45rem;
        background: linear-gradient(135deg, var(--card-color), var(--card-color)cc);
        color: white;
        flex-shrink: 0;
        box-shadow: 0 6px 14px rgba(0,0,0,0.14);
      }
      .card-content h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
        font-weight: 800;
        color: #0f172a;
      }
      .card-subtitle {
        margin: 0;
        font-size: 0.78rem;
        color: #64748b;
        font-weight: 600;
      }
      .card-footer {
        padding-top: 0.65rem;
        border-top: 1px solid #f1f5f9;
        display: flex;
        justify-content: flex-end;
      }
      .card-arrow {
        color: #94a3b8;
        font-size: 1.05rem;
        font-weight: 700;
      }

      /* View-wrapper overrides for internal views */
      .view-wrapper > * { 
        max-width: 100% !important; 
        width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
        overflow-x: hidden !important;
      }
      .view-wrapper .admin-panel-enterprise,
      .view-wrapper .cierres-enterprise,
      .view-wrapper .usuarios-enterprise,
      .view-wrapper > div[style*="100vw"],
      .view-wrapper > div[style*="100vh"] { 
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: auto !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow-x: hidden !important;
      }
      .view-wrapper .table-container {
        width: 100% !important;
        max-width: 100% !important;
        overflow-x: auto !important;
      }

      @media (max-width: 1024px) {
        .sidebar {
           position: fixed;
           top: 0;
           left: 0;
           transform: translateX(-108%);
           box-shadow: none;
        }
        .sidebar.open {
           transform: translateX(0);
           box-shadow: 6px 0 40px rgba(0,0,0,0.5);
        }
        .mobile-close-btn {
           display: flex;
        }
        .mobile-header {
           display: flex;
        }
        .view-wrapper {
           padding: 1rem;
        }
        .cards-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
        .card { padding: 1.5rem; }
        .card-icon { width: 48px; height: 48px; font-size: 1.5rem; }
        .welcome-section { margin-bottom: 2rem; }
      }

      @media (max-width: 480px) {
        .cards-grid { grid-template-columns: 1fr; }
        .mobile-header-title { font-size: 1rem; }
      }
      `}</style>

      <div className="desktop-admin-layout">
        <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
          <button
            className="mobile-close-btn"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Cerrar menú"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="sidebar-header">
            <div className="sidebar-logo">
              {datosNegocio.logo_url ? (
                <img src={datosNegocio.logo_url} alt="Logo" />
              ) : (
                <div
                  style={{
                    background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                </div>
              )}
              <div className="sidebar-title">
                {datosNegocio.nombre_negocio || "Admin Panel"}
                <div
                  style={{
                    fontSize: "0.68rem",
                    color: "rgba(255,255,255,0.38)",
                    fontWeight: "normal",
                    marginTop: "3px",
                  }}
                >
                  {user?.nombre || "Admin"}
                </div>
              </div>
            </div>
          </div>

          <nav className="sidebar-nav">
            <button
              onClick={() => handleMenuClick("menu")}
              className={`sidebar-nav-item ${currentView === "menu" ? "active" : ""}`}
            >
              <div className="sidebar-nav-icon">{navIcons["menu"]}</div>
              <div className="sidebar-nav-text">
                <div className="sidebar-nav-label">Inicio</div>
                <div className="sidebar-nav-subtitle">Panel principal</div>
              </div>
            </button>

            {cards.map((card) => (
              <button
                key={card.view}
                onClick={() => handleMenuClick(card.view)}
                className={`sidebar-nav-item ${currentView === card.view ? "active" : ""}`}
              >
                <div className="sidebar-nav-icon">
                  {navIcons[card.view] ?? (
                    <span style={{ fontSize: "1rem" }}>{card.icon}</span>
                  )}
                </div>
                <div className="sidebar-nav-text">
                  <div className="sidebar-nav-label">{card.label}</div>
                  <div className="sidebar-nav-subtitle">{card.subtitle}</div>
                </div>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button
              onClick={() => setShowLogoutModal(true)}
              className="sidebar-logout-btn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Cerrar sesión
            </button>
          </div>
        </aside>

        <div
          className={`sidebar-overlay ${isSidebarOpen ? "open" : ""}`}
          onClick={() => setIsSidebarOpen(false)}
        />

        <section className="desktop-content">
          <div className="mobile-header">
            <div className="mobile-header-left">
              <button
                className="hamburger-btn"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Abrir menú"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <div className="mobile-header-title">
                {datosNegocio.logo_url ? (
                  <img
                    src={datosNegocio.logo_url}
                    alt="Logo"
                    className="mobile-header-logo"
                  />
                ) : (
                  <span>🏪</span>
                )}
                <span>{datosNegocio.nombre_negocio || "Admin"}</span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "#64748b",
                    marginLeft: "8px",
                    fontWeight: "normal",
                  }}
                >
                  ({user?.nombre || ""})
                </span>
              </div>
            </div>
          </div>

          <div className="view-wrapper">
            {currentView === "menu" && (
              <main className="main-content">
                <div className="welcome-section">
                  <div className="welcome-hero">
                    <div>
                      <h1 className="welcome-title">Panel de Control</h1>
                      <p className="welcome-subtitle">
                        Bienvenido, selecciona una opción para comenzar.
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <div className="welcome-pill">Panel Ejecutivo</div>
                      <div className="welcome-pill secondary">Administrador</div>
                    </div>
                  </div>
                  <div className="welcome-stats">
                    <div className="welcome-stat">
                      <div className="welcome-stat-label">Módulos</div>
                      <div className="welcome-stat-value">{cards.length}</div>
                    </div>
                    <div className="welcome-stat">
                      <div className="welcome-stat-label">Usuario</div>
                      <div
                        className="welcome-stat-value"
                        style={{ fontSize: "0.95rem" }}
                      >
                        {user?.nombre || "Admin"}
                      </div>
                    </div>
                    <div className="welcome-stat">
                      <div className="welcome-stat-label">Negocio</div>
                      <div
                        className="welcome-stat-value"
                        style={{ fontSize: "0.95rem" }}
                      >
                        {datosNegocio.nombre_negocio || "Principal"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="cards-grid">
                  {cards.map((card) => (
                    <div
                      key={card.view}
                      className="card"
                      onClick={() => handleMenuClick(card.view)}
                      style={
                        { "--card-color": card.color } as React.CSSProperties
                      }
                    >
                      <div className="card-header">
                        <div
                          className="card-icon"
                          style={
                            {
                              "--card-color": card.color,
                            } as React.CSSProperties
                          }
                        >
                          {card.icon}
                        </div>
                        <div className="card-content">
                          <h3>{card.label}</h3>
                          <p className="card-subtitle">{card.subtitle}</p>
                        </div>
                      </div>
                      <div className="card-footer">
                        <span className="card-arrow">→</span>
                      </div>
                    </div>
                  ))}
                </div>
              </main>
            )}

            {currentView === "usuarios" && (
              <UsuariosView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "inventario" && (
              <InventarioView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "movimientosInventario" && (
              <MovimientosInventarioView
                onBack={() => setCurrentView("menu")}
              />
            )}
            {currentView === "cai" && (
              <CaiFacturasView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "resultados" && (
              <ResultadosView
                onBack={() => setCurrentView("menu")}
                onVerFacturasEmitidas={() => setCurrentView("facturasEmitidas")}
              />
            )}
            {currentView === "gastos" && (
              <GastosView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "facturasEmitidas" && (
              <FacturasEmitidasView
                onBack={() => setCurrentView("resultados")}
              />
            )}
            {currentView === "cierreadmin" && (
              <CierresAdminView onVolver={() => setCurrentView("menu")} />
            )}
            {currentView === "datosNegocio" && (
              <DatosNegocioView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "gananciasNetas" && (
              <GananciasNetasView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "creditosPendientes" && (
              <CreditosPendientesView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "proveedores" && (
              <ProveedoresCxPView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "donacionesMensuales" && (
              <DonacionesMensualesView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "impresoras" && (
              <ImpresorasView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "configuraciones" && (
              <ConfiguracionesView onBack={() => setCurrentView("menu")} />
            )}
            {currentView === "facturacionSAR" && (
              <FacturacionSARView onBack={() => setCurrentView("menu")} />
            )}
          </div>
        </section>
      </div>

      {showLogoutModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.5)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "24px",
              padding: "2.5rem 3rem",
              minWidth: "320px",
              maxWidth: "90%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              textAlign: "center",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
            <h2
              style={{
                color: "#0f172a",
                fontWeight: 800,
                marginBottom: "1rem",
                fontSize: "1.5rem",
              }}
            >
              Cerrar sesión
            </h2>
            <p
              style={{
                color: "#64748b",
                fontSize: "1.05rem",
                marginBottom: "2rem",
                lineHeight: 1.6,
              }}
            >
              ¿Estás seguro que deseas cerrar tu sesión actual?
            </p>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                style={{
                  background:
                    "linear-gradient(135deg, #ef4444 0%, #f59e0b 100%)",
                  color: "white",
                  fontWeight: 700,
                  border: "none",
                  borderRadius: "12px",
                  padding: "0.85rem 2rem",
                  fontSize: "1rem",
                  cursor: "pointer",
                  boxShadow: "0 4px 16px rgba(239,68,68,0.25)",
                  transition: "all 0.3s ease",
                  flex: "1 1 auto",
                }}
                onClick={() => {
                  localStorage.removeItem(ADMIN_PANEL_VIEW_KEY);
                  localStorage.removeItem("usuario");
                  window.location.href = "/";
                }}
              >
                Cerrar sesión
              </button>
              <button
                style={{
                  background: "#f1f5f9",
                  color: "#0f172a",
                  fontWeight: 600,
                  border: "none",
                  borderRadius: "12px",
                  padding: "0.85rem 2rem",
                  fontSize: "1rem",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  flex: "1 1 auto",
                }}
                onClick={() => setShowLogoutModal(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
