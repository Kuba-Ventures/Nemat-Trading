import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { captureAttribution } from "./lib/attribution";
import { trackPageViews } from "./lib/analytics";

captureAttribution();
trackPageViews();

createRoot(document.getElementById("root")!).render(<App />);
