import { cn } from "@/lib/utils";

type Props = {
  // Cor da paleta (dado, não token).
  cor: string;
  // Subcategoria: anel. Categoria principal: bolinha cheia.
  sub?: boolean;
  className?: string;
};

export function CategoryDot({ cor, sub = false, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-full",
        sub ? "size-2 border-[1.5px] bg-transparent" : "size-2.5",
        className,
      )}
      style={sub ? { borderColor: cor } : { backgroundColor: cor }}
    />
  );
}
