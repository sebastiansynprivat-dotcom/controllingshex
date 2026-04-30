import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const syncAppHeight = () => {
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
};

syncAppHeight();
window.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("resize", syncAppHeight);

createRoot(document.getElementById("root")!).render(<App />);
