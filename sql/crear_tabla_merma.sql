-- Tabla para registrar eventos de merma de inventario
create table if not exists public.merma (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid references public.insumos(id) on delete set null,
  cantidad numeric(14,4) not null default 0,
  nota text,
  referencia_tipo text,
  referencia_id text,
  cajero text,
  cajero_id text,
  fecha_hora timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_merma_insumo_id on public.merma(insumo_id);
create index if not exists idx_merma_fecha_hora on public.merma(fecha_hora desc);
