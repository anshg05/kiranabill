// KB-411 (26 §2.4): the design's icons, by the names 26 uses. lucide-react 1.x renamed four of them (Home -> House,
// MoreHorizontal -> Ellipsis, CircleHelp -> CircleQuestionMark, Phone (smartphone) -> Smartphone); the drawings are the same.
import { createElement } from "react";
import {
  ArrowRight, Bluetooth, Check, ChevronDown, ChevronLeft, ChevronRight, CircleQuestionMark, Cloud, Ellipsis, FileText, Keyboard, Languages,
  Lightbulb, Lock, MessageCircle, Minus, Package, Plus, Printer, RefreshCw,
  RotateCcw, RotateCw, Search, Share2, Smartphone, Store, WifiOff, X,
  createLucideIcon, type LucideIcon,
} from "lucide-react";

// 26 §2.4 exceptions (owner, 14 Nov 2026, D110 item 9): where lucide's drawing differs from the screen file, the file's own SVG.
const FILLED = { fill: "currentColor", strokeWidth: 1.6 };
/** 09-Recording: two filled bars */
const Pause = createLucideIcon("kb-pause", [
  ["rect", { x: "6", y: "5", width: "4", height: "14", rx: "1", ...FILLED, key: "a" }],
  ["rect", { x: "14", y: "5", width: "4", height: "14", rx: "1", ...FILLED, key: "b" }],
]);
/** 09-Recording: a filled rounded square (Stop) */
const Square = createLucideIcon("kb-stop", [["rect", { x: "6", y: "6", width: "12", height: "12", rx: "2", ...FILLED, key: "a" }]]);
/** 10-Review: a filled triangle (Play recording) */
const Play = createLucideIcon("kb-play", [["path", { d: "M8 5l11 7-11 7z", fill: "currentColor", strokeWidth: 1.5, key: "a" }]]);
/** 10-Review (and 12's "your price" chip): a single 4-point star */
const Sparkles = createLucideIcon("kb-star", [["path", { d: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", key: "a" }]]);
/** 17-More: the arrow pointing left, out of the door */
const LogOut = createLucideIcon("kb-sign-out", [
  ["path", { d: "M15 4h4v16h-4", key: "a" }],
  ["path", { d: "M10 8l-4 4 4 4M6 12h10", key: "b" }],
]);

/** 17-More / every bottom bar: a simple house (roof + walls, no door) */
const House = createLucideIcon("kb-home", [
  ["path", { d: "M3 11l9-7 9 7", key: "a" }],
  ["path", { d: "M5 10v10h14V10", key: "b" }],
]);
/** 17-More bottom bar "Bills": a torn-edge receipt with two lines */
const ReceiptText = createLucideIcon("kb-bills", [
  ["path", { d: "M6 3h12v18l-3-2-3 2-3-2-3 2z", key: "a" }],
  ["path", { d: "M9 8h6M9 12h6", key: "b" }],
]);
/** 17-More "Bill design": the same receipt with a third, short line */
const BillDesign = createLucideIcon("kb-bill-design", [
  ["path", { d: "M6 3h12v18l-3-2-3 2-3-2-3 2z", key: "a" }],
  ["path", { d: "M9 8h6M9 12h6M9 16h3", key: "b" }],
]);
/** 17-More "Privacy": a plain shield (no tick) */
const ShieldCheck = createLucideIcon("kb-privacy", [["path", { d: "M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z", key: "a" }]]);

/** 12-BillReview "More" and every mic: a capsule on a cradle with a short stem */
const Mic = createLucideIcon("kb-mic", [
  ["path", { d: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", key: "a" }],
  ["path", { d: "M5 11a7 7 0 0 0 14 0", key: "b" }],
  ["path", { d: "M12 18v3", key: "c" }],
]);
/** 12-BillReview line edit: a plain pencil outline */
const Pencil = createLucideIcon("kb-pencil", [["path", { d: "M4 20h4l11-11-4-4L4 16z", key: "a" }]]);
/** 12-BillReview "Price needed": a sharp-cornered triangle with the mark */
const TriangleAlert = createLucideIcon("kb-warning", [
  ["path", { d: "M12 3l10 18H2z", key: "a" }],
  ["path", { d: "M12 10v4M12 17h.01", key: "b" }],
]);
/** 12-BillReview "Heard:": the ear */
const Ear = createLucideIcon("kb-ear", [
  ["path", { d: "M8 18a3 3 0 0 0 3 3c2 0 2.5-1.5 3.5-3.5S18 14 18 9a6 6 0 0 0-12 0", key: "a" }],
  ["path", { d: "M10 10a2 2 0 0 1 4 0c0 1.5-2 2-2 4", key: "b" }],
]);

/** 08-Home "Shop profile": a head and shoulders (KB-414 step 1) */
const Profile = createLucideIcon("kb-profile", [
  ["circle", { cx: "12", cy: "8", r: "4", key: "a" }],
  ["path", { d: "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6", key: "b" }],
]);
/** 08-Home's hero card: the filled 4-point star that twinkles (amber; KB-414 step 1) */
const Twinkle = createLucideIcon("kb-twinkle", [["path", { d: "M12 1l2.6 7.4L22 11l-7.4 2.6L12 21l-2.6-7.4L2 11l7.4-2.6z", fill: "currentColor", stroke: "none", key: "a" }]]);

export const KB_ICONS = {
  Mic, Pause, Square, Play, RotateCcw, Keyboard, Printer, MessageCircle, FileText, Share2, ReceiptText, Home: House, Package,
  MoreHorizontal: Ellipsis, ChevronRight, ChevronLeft, Plus, Minus, Check, X, Pencil, TriangleAlert, Lightbulb, Sparkles,
  Bluetooth, RefreshCw, WifiOff, Cloud, ShieldCheck, Languages, CircleHelp: CircleQuestionMark, LogOut, Store, Phone: Smartphone,
  Ear,
  // drawn by 26 §5's components: the search field and the locked Bill Banao; 06-ShopSetup's Continue arrow
  Search, Lock, ArrowRight,
  // 17-More's "Bill design" row; 12-BillReview's Heard card opens with a chevron down
  BillDesign, ChevronDown,
  // 23-ReadFailed "Try again": one clockwise arrow round (KB-413 step 3)
  RotateCw,
  // 08-Home (KB-414 step 1)
  Profile, Twinkle,
} satisfies Record<string, LucideIcon>;

/** One icon at the design's stroke (1.9 - the Saved tick draws 2.4), coloured by its text; the button or row carries the words.
 *  size = the px the screen file draws (26 §2.4 names 18 / 20 / 22 / 24; the screens also draw 11, 13, 14, 15, 16, 17, 19).
 *  shrink-0: it keeps its size when the words beside it wrap (owner's review, 14 Nov 2026). */
export function Icon({ icon, size, strokeWidth = 1.9, className }: { icon: LucideIcon; size: number; strokeWidth?: number; className?: string }) {
  return createElement(icon, { size, strokeWidth, absoluteStrokeWidth: false, "aria-hidden": true, className: `shrink-0 ${className ?? ""}`.trim() });
}
