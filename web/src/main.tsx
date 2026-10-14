import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Old links or "open in new tab" put the query inside the hash (#/my-bookings?tab=market). wouter's hash routing
// reads the query from the real ?search, so a ? in the hash fails to match any route and 404s. Rewrite it to /?tab=market#/my-bookings before startup.
{
  const { hash, pathname, search } = window.location;
  const q = hash.indexOf("?");
  if (hash.startsWith("#/") && q > 0) {
    const merged = [search.replace(/^\?/, ""), hash.slice(q + 1)].filter(Boolean).join("&");
    window.history.replaceState(window.history.state, "", `${pathname}?${merged}${hash.slice(0, q)}`);
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
