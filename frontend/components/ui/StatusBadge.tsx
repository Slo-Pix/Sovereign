import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleX,
  Hourglass,
  type LucideIcon,
} from "lucide-react";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; icon: LucideIcon }> = {
  ACTIVE: { bg: "#E6F4EA", text: "#00875A", icon: CheckCircle2 },
  SETTLED: { bg: "#ECEAE2", text: "#1b1c19", icon: Circle },
  UNWOUND: { bg: "#FEE2E2", text: "#DC2626", icon: CircleX },
  PENDING: { bg: "#FEF3C7", text: "#B45309", icon: Hourglass },
  DEFAULT: { bg: "#ECEAE2", text: "#1b1c19", icon: CircleAlert },
};

export default function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.DEFAULT;
  const padding = size === "md" ? "px-3 py-1" : "px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${padding} border border-on-surface font-label-caps text-label-caps font-bold`}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      <config.icon size={size === "md" ? 14 : 12} strokeWidth={2.5} aria-hidden="true" />
      {status}
    </span>
  );
}
