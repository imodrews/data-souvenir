"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();
  const isFinalVisualisation = pathname.startsWith("/souvenir/") || pathname.startsWith("/floor-test/") || pathname.startsWith("/ending-test/");

  return (
    <nav>
      <Link href="/">{isFinalVisualisation ? "Start your journey again" : "Home"}</Link>
      {!isFinalVisualisation && <Link href="/souvenir">Souvenir</Link>}
    </nav>
  );
}