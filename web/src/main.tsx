import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// 舊連結或「另開新分頁」把 query 放在 hash 裡（#/my-bookings?tab=market）：wouter 的 hash 路由
// 把 query 放在真正的 ?search，hash 帶 ? 會比對不到路由而 404。開站前先改寫成 /?tab=market#/my-bookings。
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
