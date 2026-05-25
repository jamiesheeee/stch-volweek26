/* eslint-disable react/no-unknown-property */
import { useEffect, useRef, useState } from "react";
import {
  XRProvider,
  XRScene,
  VideoBackground,
  useXRContext,
  XRMediaSource,
} from "@vincentt-sdks/xr-sdk";
import { PerspectiveCamera } from "@react-three/drei";
import { Scene } from "./Scene";
import { FinalPage } from "./FinalPage";

const MediaSourceBinder = () => {
  const { session } = useXRContext();
  useEffect(() => {
    (async () => {
      try {
        await session.setMediaSource({ source: XRMediaSource.WEBCAM });
        await session.start();
      } catch (err) {
        console.error("[volunteers-week] media/start failed:", err);
      }
    })();
  }, [session]);
  return null;
};

export const App = () => {
  const bgmRef = useRef<HTMLAudioElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [shrunk, setShrunk] = useState(false); // drives the shrink-in animation
  const [controlsVisible, setControlsVisible] = useState(false); // staggered after shrink
  const [consent, setConsent] = useState(false);
  const [consentSubmitted, setConsentSubmitted] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [resetToken, setResetToken] = useState(0); // bump to reset Scene to thank-you + prompt

  // Hold briefly at the enlarged state, then shrink into the card, then reveal controls.
  useEffect(() => {
    if (!photo) { setShrunk(false); setControlsVisible(false); return; }
    const t1 = setTimeout(() => setShrunk(true), 1200);
    const t2 = setTimeout(() => setControlsVisible(true), 1900); // after the shrink lands
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [photo]);

  const retake = () => {
    // 1) controls fade out, 2) card grows back to full-screen, 3) unmount + reset.
    setControlsVisible(false);
    setConsent(false);
    setConsentSubmitted(false);
    setShowFinal(false);
    setTimeout(() => setShrunk(false), 350); // after controls have faded
    setTimeout(() => {
      setPhoto(null);
      setResetToken((n) => n + 1);
      bgmRef.current?.play().catch(() => {}); // resume music back at full screen
    }, 350 + 750); // after the expand transition
  };

  const onCelebrate = () => {
    // Confetti is now the in-scene sprite-sheet particle system (Scene.tsx).
    const a = bgmRef.current;
    if (a) {
      a.volume = 0.5;
      a.currentTime = 0;
      a.play().catch(() => {}); // user gesture (hand release) satisfies autoplay
    }
  };

  // Capture the WebGL canvas (camera + frame + thank-you, countdown already gone).
  const onCapture = () => {
    const wrap = wrapRef.current;
    const gl = wrap?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!gl) return;
    // Read on the next frame so the final rendered frame is in the buffer.
    requestAnimationFrame(() => {
      try {
        setPhoto(gl.toDataURL("image/png"));
        bgmRef.current?.pause(); // pause music while reviewing the photo
      } catch {
        /* tainted canvas (cross-origin camera) — ignore */
      }
    });
  };

  const download = () => {
    if (!photo) return;
    const a = document.createElement("a");
    a.href = photo;
    a.download = "volunteers-week-2026.png";
    a.click();
  };


  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
      }}
    >
      <div
        ref={wrapRef}
        style={{
          // Fit entirely within the viewport: cap by height (portrait) AND by
          // width, so the bottom is never clipped on short windows.
          height: "min(100vh, 177.78vw)",
          width: "min(56.25vh, 100vw)",
          aspectRatio: "720 / 1280",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <XRProvider>
          <XRScene
            style={{ width: "100%", height: "100%" }}
            canvasProps={{ dpr: [1, 2], gl: { preserveDrawingBuffer: true } }}
          >
            <MediaSourceBinder />
            <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={45} />
            <VideoBackground customBackground="#6366f1" renderOrder={-999} />
            <ambientLight intensity={1} />
            <directionalLight position={[5, 5, 5]} intensity={1} />
            <Scene onCelebrate={onCelebrate} onCapture={onCapture} resetToken={resetToken} />
          </XRScene>
        </XRProvider>
        {/* Celebration BGM — plays on hand-release trigger */}
        <audio ref={bgmRef} src="/assets/bgm.m4a" preload="auto" />

        {/* Photo preview — full-bleed shot freezes, then shrinks into a card */}
        {photo && (
          <div
            style={{
              position: "absolute", inset: 0, zIndex: 20,
              background: "#faf7f2",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {/* Photo: fills the frame, then scales+rises into a top card.
                Capture is 720:1280 like the container, so contain == no crop/gap. */}
            <img
              src={photo}
              alt="Your photo"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                transformOrigin: "center top",
                transform: shrunk ? "translateY(4%) scale(0.66)" : "translateY(0) scale(1)",
                borderRadius: shrunk ? 24 : 0,
                boxShadow: shrunk ? "0 10px 30px rgba(0,0,0,0.18)" : "none",
                transition:
                  "transform 750ms cubic-bezier(0.22,1,0.36,1), border-radius 750ms ease, box-shadow 750ms ease",
              }}
            />

            {/* Controls: sit just below the shrunk photo, fade/slide in */}
            <div style={{
              position: "absolute", left: 0, right: 0, top: "74%",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 22,
              padding: "0 8%", boxSizing: "border-box",
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible ? "translateY(0)" : "translateY(20px)",
              transition: "opacity 350ms ease, transform 350ms ease",
              pointerEvents: controlsVisible ? "auto" : "none",
            }}>
              {/* Retake / Download — above the consent block */}
              <div style={{ display: "flex", gap: 14 }}>
                <button onClick={retake} style={previewBtn("outline")}>Retake</button>
                <button onClick={download} style={previewBtn("solid")}>Download</button>
              </div>

              {/* Data privacy consent */}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.4, color: "#555", maxWidth: 420, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => { setConsent(e.target.checked); setConsentSubmitted(false); }}
                  style={{ marginTop: 2, width: 18, height: 18, accentColor: "#e72a7c", flexShrink: 0 }}
                />
                <span>
                  I agree to the{" "}
                  <a href="#" style={{ color: "#e72a7c", textDecoration: "underline" }}>data privacy policy</a>{" "}
                  and consent to my photo being stored and used.
                </span>
              </label>

              <button
                onClick={() => {
                  if (!consent || consentSubmitted) return;
                  setConsentSubmitted(true);
                  // Brief delay, then send the user to the final thank-you page.
                  setTimeout(() => setShowFinal(true), 1200);
                }}
                disabled={!consent || consentSubmitted}
                style={previewBtn("solid", !consent || consentSubmitted)}
              >
                {consentSubmitted ? "Consent Submitted ✓" : "Submit Consent"}
              </button>
            </div>
          </div>
        )}

        {/* Final thank-you page (after consent submitted) */}
        {showFinal && <FinalPage />}
      </div>
    </div>
  );
};

function previewBtn(kind: "solid" | "outline", disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 999, padding: "13px 30px", fontSize: 16, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit", transition: "opacity 150ms ease",
  };
  if (kind === "outline") {
    return { ...base, background: "transparent", color: "#e72a7c", border: "1.5px solid #e72a7c" };
  }
  return {
    ...base, background: "#e72a7c", color: "#fff", border: "1.5px solid #e72a7c",
    opacity: disabled ? 0.4 : 1,
  };
}
