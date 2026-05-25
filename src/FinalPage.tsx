import { useEffect, useRef } from "react";
import QRCode from "qrcode";

const LINK = "bit.ly/3V1HjyE";
const QR_URL = "https://bit.ly/3V1HjyE";
const MAGENTA = "#c2185b";
const NAVY = "#2b1b3d";
const CONFETTI = ["#f4a4c0", "#9b5fb0", "#3fb8af", "#f4a259", "#ffffff", "#e0508a"];

// Scattered decorative confetti flecks (deterministic positions).
const FLECKS = Array.from({ length: 46 }, (_, i) => {
  const seed = (i * 9301 + 49297) % 233280;
  const r = (n: number) => ((seed * (n + 1)) % 1000) / 1000;
  return {
    top: `${r(1) * 92 + 2}%`,
    left: `${r(2) * 94 + 2}%`,
    rot: r(3) * 360,
    w: 8 + r(4) * 12,
    h: 5 + r(5) * 7,
    color: CONFETTI[i % CONFETTI.length],
    round: r(6) > 0.7,
  };
});

export function FinalPage() {
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (qrRef.current) {
      QRCode.toCanvas(qrRef.current, QR_URL, {
        width: 150, margin: 1,
        color: { dark: NAVY, light: "#ffffff" },
      }).catch(() => {});
    }
  }, []);

  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 30,
        background: MAGENTA,
        display: "flex", flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#fff", overflow: "hidden",
      }}
    >
      {/* confetti */}
      {FLECKS.map((f, i) => (
        <span
          key={i}
          style={{
            position: "absolute", top: f.top, left: f.left,
            width: f.w, height: f.h, background: f.color,
            borderRadius: f.round ? "50%" : 2,
            transform: `rotate(${f.rot}deg)`, opacity: 0.9,
          }}
        />
      ))}

      {/* main content */}
      <div style={{ position: "relative", flex: 1, padding: "7% 7% 0", display: "flex", flexDirection: "column", gap: "3%" }}>
        <div>
          <div style={{ fontSize: "clamp(20px, 6vw, 34px)", fontWeight: 800, letterSpacing: 0.5, lineHeight: 1.05 }}>
            LET'S CELEBRATE
          </div>
          <div style={{ fontSize: "clamp(30px, 9vw, 52px)", fontWeight: 900, color: NAVY, lineHeight: 1, marginTop: 2 }}>
            VOLUNTEERS!
          </div>
        </div>

        <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: "clamp(44px, 13vw, 76px)", lineHeight: 0.95 }}>
          Thank you
        </div>

        <div style={{ color: NAVY, fontWeight: 800, fontSize: "clamp(15px, 4.4vw, 24px)", lineHeight: 1.25 }}>
          to the incredible volunteers supporting St Christopher's this Volunteers' Week
        </div>

        <div style={{ fontWeight: 700, fontSize: "clamp(13px, 3.6vw, 19px)", lineHeight: 1.35 }}>
          If you see a volunteer during your visit today, please take a moment to share a smile or a word of thanks.
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "5%", marginTop: "auto", marginBottom: "5%" }}>
          <canvas ref={qrRef} style={{ background: "#fff", borderRadius: 8, padding: 6, flexShrink: 0 }} />
          <div style={{ fontWeight: 700, fontSize: "clamp(13px, 3.6vw, 19px)", lineHeight: 1.35 }}>
            You can also scan this QR code or visit{" "}
            <span style={{ fontWeight: 900 }}>{LINK}</span> to leave them an online message!
          </div>
        </div>
      </div>

      {/* footer */}
      <div style={{ position: "relative", background: NAVY, padding: "5% 7%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: "clamp(14px, 4vw, 22px)", lineHeight: 1, letterSpacing: 0.5 }}>
            ★ VOLUNTEERS'<br />WEEK
          </div>
          <div style={{ marginTop: 8, fontSize: "clamp(10px, 2.8vw, 14px)", textDecoration: "underline" }}>
            stchristophers.org.uk/volunteering
          </div>
        </div>
        <div style={{ fontWeight: 900, fontSize: "clamp(14px, 4vw, 22px)", display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: MAGENTA, fontSize: "1.4em" }}>C</span>
          <span style={{ fontSize: "0.55em", alignSelf: "flex-start", marginTop: "0.4em" }}>ST</span>CHRISTOPHER'S
        </div>
      </div>
    </div>
  );
}
