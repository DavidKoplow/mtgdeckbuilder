type AppIconProps = {
  size?: number;
  className?: string;
  label?: string;
};

export function AppIcon({
  size = 40,
  className = "",
  label,
}: AppIconProps) {
  return (
    <img
      src="/deck-builder-icon.svg"
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={`shrink-0 rounded-xl ${className}`}
    />
  );
}
