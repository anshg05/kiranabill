// KB-411 (26 §2.4): the design's icons, by the names 26 uses. lucide-react 1.x renamed four of them (Home -> House,
// MoreHorizontal -> Ellipsis, CircleHelp -> CircleQuestionMark, Phone (smartphone) -> Smartphone); the drawings are the same.
import { createElement } from "react";
import {
  Bluetooth, Check, ChevronLeft, ChevronRight, CircleQuestionMark, Cloud, Ear, Ellipsis, FileText, House, Keyboard, Languages,
  Lightbulb, Lock, LogOut, MessageCircle, Mic, Minus, Package, Pause, Pencil, Play, Plus, Printer, ReceiptText, RefreshCw,
  RotateCcw, Search, Share2, ShieldCheck, Smartphone, Sparkles, Square, Store, TriangleAlert, WifiOff, X,
  type LucideIcon,
} from "lucide-react";

export const KB_ICONS = {
  Mic, Pause, Square, Play, RotateCcw, Keyboard, Printer, MessageCircle, FileText, Share2, ReceiptText, Home: House, Package,
  MoreHorizontal: Ellipsis, ChevronRight, ChevronLeft, Plus, Minus, Check, X, Pencil, TriangleAlert, Lightbulb, Sparkles,
  Bluetooth, RefreshCw, WifiOff, Cloud, ShieldCheck, Languages, CircleHelp: CircleQuestionMark, LogOut, Store, Phone: Smartphone,
  Ear,
  // drawn by 26 §5's components: the search field and the locked Bill Banao
  Search, Lock,
} satisfies Record<string, LucideIcon>;

export type IconSize = 11 | 18 | 20 | 22 | 24;

/** One icon at the design's stroke (1.9), coloured by its text; the button or row it sits in carries the words. */
export function Icon({ icon, size, className }: { icon: LucideIcon; size: IconSize; className?: string }) {
  return createElement(icon, { size, strokeWidth: 1.9, absoluteStrokeWidth: false, "aria-hidden": true, className });
}
