import { HashRouter, Routes, Route } from "react-router-dom";
import { DashboardLayout } from "./layout/DashboardLayout";
import { Overview } from "./pages/Overview";
import { Sessions } from "./pages/Sessions";
import { KnowledgeGraph } from "./pages/KnowledgeGraph";
import { Logs } from "./pages/Logs";
import { Todos } from "./pages/Todos";
import { Security } from "./pages/Security";
import { Features } from "./pages/Features";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/knowledge-graph" element={<KnowledgeGraph />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/security" element={<Security />} />
          <Route path="/features" element={<Features />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
