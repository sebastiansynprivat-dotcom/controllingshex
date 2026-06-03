import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const isStandaloneDisplay = () =>
  window.matchMedia("(display-mode: fullscreen)").matches ||
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

const syncAppHeight = () => {
  const viewport = window.visualViewport;
  const innerH = window.innerHeight;
  const vvH = viewport?.height ?? innerH;
  const standalone = isStandaloneDisplay();
  const screenH = window.screen?.height ?? innerH;
  // iOS standalone kann innerHeight ebenfalls ohne Home-Indicator-Safe-Area liefern.
  // Dann die volle Screen-Höhe nutzen; nur beim Keyboard bewusst auf visualViewport schrumpfen.
  const keyboardOpen = innerH - vvH > 100;
  const height = keyboardOpen ? vvH : standalone ? Math.max(innerH, screenH) : innerH;
  const offsetTop = keyboardOpen ? viewport?.offsetTop ?? 0 : 0;

  document.documentElement.style.setProperty("--app-height", `${Math.ceil(height)}px`);
  document.documentElement.style.setProperty("--app-viewport-offset-top", `${Math.floor(offsetTop)}px`);
};

const syncDisplayMode = () => {
  document.documentElement.classList.toggle("app-standalone", isStandaloneDisplay());
};

syncAppHeight();
syncDisplayMode();
window.addEventListener("resize", syncAppHeight);
window.addEventListener("orientationchange", syncAppHeight);
window.visualViewport?.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("scroll", syncAppHeight);
window.matchMedia("(display-mode: fullscreen)").addEventListener("change", syncDisplayMode);
window.matchMedia("(display-mode: standalone)").addEventListener("change", syncDisplayMode);

createRoot(document.getElementById("root")!).render(<App />);
