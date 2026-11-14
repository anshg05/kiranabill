// KB-411 (26 §2.4): the design's icons, by the names 26 uses. lucide-react 1.x renamed four of them (Home -> House,
// MoreHorizontal -> Ellipsis, CircleHelp -> CircleQuestionMark, Phone (smartphone) -> Smartphone); the drawings are the same.
import { createElement } from "react";
import {
  ArrowRight, Bluetooth, Check, ChevronLeft, ChevronRight, CircleQuestionMark, Cloud, Ear, Ellipsis, FileText, House, Keyboard, Languages,
  Lightbulb, Lock, LogOut, MessageCircle, Mic, Minus, Package, Pause, Pencil, Play, Plus, Printer, ReceiptText, RefreshCw,
  RotateCcw, Search, Share2, ShieldCheck, Smartphone, Sparkles, Square, Store, TriangleAlert, WifiOff, X,
  type LucideIcon,
} from "lucide-react";

export const KB_ICONS = {
  Mic, Pause, Square, Play, RotateCcw, Keyboard, Printer, MessageCircle, FileText, Share2, ReceiptText, Home: House, Package,
  MoreHorizontal: Ellipsis, ChevronRight, ChevronLeft, Plus, Minus, Check, X, Pencil, TriangleAlert, Lightbulb, Sparkles,
  Bluetooth, RefreshCw, WifiOff, Cloud, ShieldCheck, Languages, CircleHelp: CircleQuestionMark, LogOut, Store, Phone: Smartphone,
  Ear,
  // drawn by 26 §5's components: the search field and the locked Bill Banao; 06-ShopSetup's Continue arrow
  Search, Lock, ArrowRight,
} satisfies Record<string, LucideIcon>;

/** One icon at the design's stroke (1.9 - the Saved tick draws 2.4), coloured by its text; the button or row carries the words.
 *  size = the px the screen file draws (26 §2.4 names 18 / 20 / 22 / 24; the screens also draw 11, 13, 14, 15, 16, 17, 19). */
export function Icon({ icon, size, strokeWidth = 1.9, className }: { icon: LucideIcon; size: number; strokeWidth?: number; className?: string }) {
  return createElement(icon, { size, strokeWidth, absoluteStrokeWidth: false, "aria-hidden": true, className });
}
