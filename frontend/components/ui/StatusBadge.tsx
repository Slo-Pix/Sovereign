interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; icon?: string }> = {
  ACTIVE: { bg: "#E6F4EA", text: "#00875A", icon: "check_circle" },
  SETTLED: { bg: "#ECEAE2", text: "#1b1c19", icon: "remove" },
  UNWOUND: { bg: "#FEE2E2", text: "#DC2626", icon: "cancel" },
  PENDING: { bg: "#FEF3C7", text: "#B45309", icon: "hourglass_empty" },
  DEFAULT: { bg: "#ECEAE2", text: "#1b1c19", icon: "info" },
};

// Fixture-only badge. Public RPC state is displayed separately in Monitoring.
export default function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.DEFAULT;
  const padding = size === "md" ? "px-3 py-1" : "px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${padding} border border-on-surface font-label-caps text-label-caps font-bold`}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.icon && (
        <span
          className="material-symbols-outlined"
          style={{ fontSize: size === "md" ? "14px" : "12px" }}
        >
          {config.icon}
        </span>
      )}
      DEMO / {status}
    </span>
  );
}
