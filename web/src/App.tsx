import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import NewScan from "./pages/NewScan";
import History from "./pages/History";
import Targets from "./pages/Targets";
import Pipelines from "./pages/Pipelines";
import PipelineResults from "./pages/PipelineResults";
import ScanResults from "./pages/ScanResults";
import TargetDetail from "./pages/TargetDetail";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scan" element={<NewScan />} />
        <Route path="/history" element={<History />} />
        <Route path="/targets" element={<Targets />} />
        <Route path="/targets/:domain" element={<TargetDetail />} />
        <Route path="/scans/:id" element={<ScanResults />} />
        <Route path="/pipelines" element={<Pipelines />} />
        <Route path="/pipelines/:id/results" element={<PipelineResults />} />
      </Route>
    </Routes>
  );
}
