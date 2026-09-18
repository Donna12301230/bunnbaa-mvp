import { ReactNode } from "react";
import Navbar from "./Navbar";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-6xl mx-auto w-full px-3 md:px-4 py-3 md:py-6">
        {children}
      </main>
      <footer className="text-center text-xs text-muted-foreground py-4 border-t bg-white">
        <a href="mailto:herzbaa@gmail.com" className="hover:text-orange-600 hover:underline">聯絡客服</a>
        <span className="mx-2">·</span>
        © 2026 赫滋與羊國際藝術有限公司
      </footer>
    </div>
  );
}
