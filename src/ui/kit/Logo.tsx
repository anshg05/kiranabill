import logoUrl from "./logo-blue2.svg";

// KB-412 batch c (26 §4): the main logo, logo-blue2.svg (a byte-for-byte copy of docs/design/logo-blue2.svg, tested), at the sizes
// the screens draw it with their corners: 42 (radius 9; 08-Home, 26-FirstDay), 52 (12; 17-More), 76 (16; 05-SignIn); with the
// blue shadow where the screen draws it (05, 08). Decorative unless the screen names it (alt).
const RADIUS = { 42: "rounded-[9px]", 52: "rounded-[12px]", 76: "rounded-[16px]" } as const;

export function Logo({ size, shadow = false, alt = "" }: { size: keyof typeof RADIUS; shadow?: boolean; alt?: string }) {
  return <img src={logoUrl} alt={alt} width={size} height={size} className={`block flex-none ${RADIUS[size]} ${shadow ? "shadow-kb-logo" : ""}`} />;
}
