import { cn } from "@/lib/utils";

// Barra de passos das telas de acesso: "Passo N de T · rótulo", com um segmento por passo.
// "sobre-verde": dentro do topo verde (celular e tablet), texto branco a 82 % e segmentos brancos (feitos) e brancos a 30 % (por fazer).
// "sobre-fundo": na coluna do formulário (desktop).
export type Passos = { current: number; total: number; label: string };
export type VarianteDaBarra = "sobre-verde" | "sobre-fundo";

export function StepBar({
  current,
  total,
  label,
  variante = "sobre-fundo",
}: Passos & { variante?: VarianteDaBarra }) {
  const sobreVerde = variante === "sobre-verde";

  return (
    <div className={cn("flex flex-col gap-2", sobreVerde && "text-white/82")}>
      <p className={cn(sobreVerde ? "text-[12px] font-bold" : "text-[13px] font-semibold text-ink-2")}>
        Passo {current} de {total} · {label}
      </p>
      <div className={cn("flex", sobreVerde ? "gap-1.5" : "gap-1.5")} aria-hidden="true">
        {Array.from({ length: total }, (_, indice) => indice + 1).map((passo) => {
          const feito = passo <= current;
          if (sobreVerde) {
            return (
              <span
                key={passo}
                className={cn("h-1 flex-1 rounded-[2px]", feito ? "bg-white" : "bg-white/30")}
              />
            );
          }
          return (
            <span
              key={passo}
              className={cn("h-1.5 flex-1 rounded-full", feito ? "bg-primary" : "bg-divider")}
            />
          );
        })}
      </div>
    </div>
  );
}
