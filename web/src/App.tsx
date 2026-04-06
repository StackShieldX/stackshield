import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import NewScan from "./pages/NewScan";
import History from "./pages/History";
import Pipelines from "./pages/Pipelines";
import ScanResults from "./pages/ScanResults";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scan" element={<NewScan />} />
        <Route path="/history" element={<History />} />
        <Route path="/scans/:id" element={<ScanResults />} />
        <Route path="/pipelines" element={<Pipelines />} />
      </Route>
    </Routes>
  );
}
