import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Redirects from "./Redirects"
import "./redirects.css"

createRoot(document.getElementById("root")!).render(<StrictMode><Redirects /></StrictMode>)
