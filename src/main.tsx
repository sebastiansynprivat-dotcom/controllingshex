import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const syncAppHeight = () => {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;

  document.documentElement.style.setProperty("--app-height", `${Math.ceil(height)}px`);
  document.documentElement.style.setProperty("--app-viewport-offset-top", `${Math.floor(offsetTop)}px`);
};

const syncDisplayMode = () => {
  const isStandalone =
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

  document.documentElement.classList.toggle("app-standalone", isStandalone);
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
