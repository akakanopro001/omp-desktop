import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DesktopApp } from "@/desktop/DesktopApp";
import { Landing } from "@/pages/Landing";
import { NotFound } from "@/pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<DesktopApp />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
