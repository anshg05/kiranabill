import logoUrl from "./logo-blue2.svg";
import lightUrl from "./logo-light.svg";

// KB-412 batch c (26 §4): the main logo, logo-blue2.svg (a byte-for-byte copy of docs/design/logo-blue2.svg, tested), at the sizes
// the screens draw it with their corners: 42 (radius 9; 08-Home, 26-FirstDay), 52 (12; 17-More), 76 (16; 05-SignIn); with the
// blue shadow where the screen draws it (05, 08). Decorative unless the screen names it (alt).
// KB-415: 92 (radius 20) - the light logo (logo-light.svg: white tile) on 01-Main's blue splash, with the blue shadow
const RADIUS = { 42: "rounded-[9px]", 52: "rounded-[12px]", 76: "rounded-[16px]", 92: "rounded-[20px]" } as const;

export function Logo({ size, shadow = false, alt = "", light = false }: { size: keyof typeof RADIUS; shadow?: boolean; alt?: string; light?: boolean }) {
  return <img src={light ? lightUrl : logoUrl} alt={alt} width={size} height={size} className={`block flex-none ${RADIUS[size]} ${shadow ? "shadow-kb-logo" : ""}`} />;
}
