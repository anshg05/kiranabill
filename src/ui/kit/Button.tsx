import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon, KB_ICONS } from "./icons";

// KB-412 (26 §5): the buttons as the screen files draw them, full width unless fill={false} (the files' links are display:flex).
// The files size a bordered element without its border (CSS content-box), so a "50" secondary is 52 on screen: BORDERED_H.
// Heights / radii / sizes are the files' own values:
//   primary 54 (18 'Test print', 13, 19, 23), 56 (06 'Continue'), 58 (09 'Stop'); secondary 50 (10), 52 (22, 23), 56 (12 'More'),
//   58 (09 'Pause'); tertiary 46 (25 'Keep'); destructive fill 54 (25), outline 50 (17 'Sign out'), text 46 (15); locked 56 (12).
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive" | "destructive-outline" | "destructive-text" | "locked";
export type ButtonHeight = 46 | 50 | 52 | 54 | 56 | 58;

const DEFAULT_HEIGHT: Record<ButtonVariant, ButtonHeight> = {
  primary: 54, secondary: 50, tertiary: 46, destructive: 54, "destructive-outline": 50, "destructive-text": 46, locked: 56,
};
const H: Record<ButtonHeight, string> = {
  46: "min-h-[46px]", 50: "min-h-[50px]", 52: "min-h-[52px]", 54: "min-h-[54px]", 56: "min-h-[56px]", 58: "min-h-[58px]",
};
const BORDERED_H: Record<ButtonHeight, string> = {
  46: "min-h-[48px]", 50: "min-h-[52px]", 52: "min-h-[54px]", 54: "min-h-[56px]", 56: "min-h-[58px]", 58: "min-h-[60px]",
};
const BORDERED = new Set<ButtonVariant>(["secondary", "destructive-outline"]);

function look(variant: ButtonVariant, height: ButtonHeight): string {
  const big = height === 58; // 09-Recording's Pause / Stop: radius 18
  switch (variant) {
    case "primary":
      return `bg-kb-primary text-kb-card shadow-kb-primary text-kb-16 active:bg-kb-primary-deep ${big ? "rounded-[18px] gap-2" : "rounded-[16px] gap-[10px]"}`;
    case "secondary":
      return `bg-kb-card border border-kb-border text-kb-ink gap-2 ${big ? "rounded-[18px] text-kb-16" : height === 56 ? "rounded-[16px] text-kb-15" : "rounded-[14px] text-kb-15"}`;
    case "tertiary":
      return "text-kb-sub text-kb-15 gap-2";
    case "destructive":
      return "bg-kb-err text-kb-card text-kb-16 rounded-[16px] gap-[10px]";
    case "destructive-outline":
      return "bg-kb-card border border-kb-border text-kb-err text-kb-15 rounded-[14px] gap-2";
    case "destructive-text":
      return "text-kb-err text-kb-15 gap-2";
    case "locked":
      return "bg-kb-disabled-bg text-kb-disabled-text text-kb-16 rounded-[16px] gap-2";
  }
}

export function Button({
  variant, height, icon, iconSize = 18, iconEnd = false, fill = true, reasonId, onClick, children, className = "", type = "button",
}: {
  variant: ButtonVariant;
  height?: ButtonHeight;
  icon?: LucideIcon;
  iconSize?: number;
  /** the icon after the words (06-ShopSetup 'Continue' →) */
  iconEnd?: boolean;
  /** false = as wide as its words (12-BillReview 'More' beside Bill Banao) */
  fill?: boolean;
  /** locked only: the id of the line that says why (26 §5: "It must say why on the line above"). */
  reasonId?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  const h = height ?? DEFAULT_HEIGHT[variant];
  const locked = variant === "locked";
  return (
    <button
      type={type}
      onClick={onClick}
      aria-disabled={locked ? true : undefined}
      aria-describedby={locked ? reasonId : undefined}
      className={`font-kb kb-press kb-hit flex items-center justify-center font-bold ${fill ? "w-full" : ""} ${(BORDERED.has(variant) ? BORDERED_H : H)[h]} ${look(variant, h)} ${className}`}
    >
      {locked ? <Icon icon={KB_ICONS.Lock} size={18} /> : icon && !iconEnd && <Icon icon={icon} size={iconSize} />}
      {children}
      {icon && iconEnd && !locked && <Icon icon={icon} size={iconSize} />}
    </button>
  );
}
