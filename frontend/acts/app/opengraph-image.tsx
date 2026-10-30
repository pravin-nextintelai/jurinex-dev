import { ImageResponse } from "next/og";

export const alt = "Jurinex Bare Acts – full text of Indian central acts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default share image, generated once at build time. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #06857b 0%, #08a393 60%, #21b3a4 100%)",
          color: "#ffffff",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "#ffffff",
              color: "#08a393",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            J
          </div>
          <div style={{ fontSize: 36, letterSpacing: 6, fontWeight: 700 }}>JURINEX</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 30, letterSpacing: 8, textTransform: "uppercase", opacity: 0.85 }}>Bare Acts of India</div>
          <div style={{ fontSize: 68, lineHeight: 1.1, fontWeight: 700, maxWidth: 1000 }}>Full text of central acts, section by section</div>
        </div>
        <div style={{ fontSize: 26, opacity: 0.85 }}>BNS, BNSS, BSA, Constitution and more</div>
      </div>
    ),
    size,
  );
}
