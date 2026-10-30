import Image from "next/image";
import { BASE_PATH } from "@/lib/route";

/**
 * JURINEX brand lockup, copied from the React app's BrandLogo: a teal tile with
 * the white gavel glyph followed by the wordmark. Fixed dimensions avoid layout
 * shift. Images are served unoptimized, and in that mode next/image does not
 * add the basePath itself, so the /acts prefix is part of the src.
 */
export default function BrandLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const tile = size === "lg" ? 40 : 36;
  const textHeight = size === "lg" ? 40 : 36;
  const textWidth = Math.round((626 / 169) * textHeight);

  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      <span className="flex-none overflow-hidden rounded-md bg-nx-teal" style={{ width: tile, height: tile }}>
        <Image src={`${BASE_PATH}/brand/jurinex-gavel.png`} alt="" aria-hidden="true" width={tile} height={tile} priority />
      </span>
      <Image src={`${BASE_PATH}/brand/jurinex-wordtext.png`} alt="JURINEX" width={textWidth} height={textHeight} priority />
    </span>
  );
}
