import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initMetaPixel } from "./lib/metaPixel";

initMetaPixel();

createRoot(document.getElementById("root")!).render(<App />);
