interface Props {
  message: string;
  type?: "default" | "success" | "error";
}

const ICONS: Record<NonNullable<Props["type"]>, string> = {
  default: "ℹ️",
  success: "✅",
  error: "❌",
};

export function StatusBar({ message, type = "default" }: Props) {
  if (!message || message === "Ready") {
    return null;
  }

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <div className={`status-toast${type !== "default" ? ` ${type}` : ""}`} key={`${type}:${message}`}>
        <span aria-hidden="true">{ICONS[type]}</span>
        {message}
      </div>
    </div>
  );
}
