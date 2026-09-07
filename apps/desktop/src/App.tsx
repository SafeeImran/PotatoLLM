import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "./api/settings";
import { HardwareScan } from "./onboarding/HardwareScan";
import { AppShell, PageFrame } from "./components/layout/AppShell";
import { PlaygroundProvider } from "./playground/PlaygroundProvider";
import Dashboard from "./pages/Dashboard";
import Hardware from "./pages/Hardware";
import ModelLibrary from "./pages/ModelLibrary";
import PackDetail from "./pages/PackDetail";
import Downloads from "./pages/Downloads";
import Playground from "./pages/Playground";
import Optimize from "./pages/Optimize";
import Benchmarks from "./pages/Benchmarks";
import Usage from "./pages/Usage";
import Builds from "./pages/Builds";
import FineTune from "./pages/FineTune";
import Storage from "./pages/Storage";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import Profile from "./pages/Profile";
import { useState } from "react";

function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        {/* The Playground is the app's face: it owns "/" and renders without the
            page frame so its transcript scrolls under a pinned composer. */}
        <Route path="/" element={<Playground />} />
        <Route path="/playground" element={<Navigate to="/" replace />} />

        <Route element={<PageFrame />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/models" element={<ModelLibrary />} />
          <Route path="/packs/:packId" element={<PackDetail />} />
          <Route path="/optimize" element={<Optimize />} />
          <Route path="/finetune" element={<FineTune />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/hardware" element={<Hardware />} />
          <Route path="/benchmarks" element={<Benchmarks />} />
          <Route path="/builds" element={<Builds />} />
          <Route path="/storage" element={<Storage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/downloads" element={<Downloads />} />
        </Route>
      </Routes>
    </AppShell>
  );
}

export default function App() {
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.list,
    retry: 2,
  });
  const [forceOnboarded, setForceOnboarded] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg text-sm text-fg-muted">
        Starting Potato Core...
      </div>
    );
  }

  const onboarded = forceOnboarded || Boolean(settingsData?.onboarding_complete?.value);

  if (!onboarded) {
    return <HardwareScan onDone={() => setForceOnboarded(true)} />;
  }

  return (
    <HashRouter>
      <PlaygroundProvider>
        <AppRoutes />
      </PlaygroundProvider>
    </HashRouter>
  );
}
