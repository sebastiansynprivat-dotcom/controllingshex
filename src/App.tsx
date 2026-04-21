import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlatformProvider } from "@/contexts/PlatformContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import UploadPage from "@/pages/Upload";
import Models from "@/pages/Models";
import SettingsPage from "@/pages/SettingsPage";
import AIConsultant from "@/pages/AIConsultant";
import Videocoaching from "@/pages/Videocoaching";
import Leaderboard from "@/pages/Leaderboard";
import Notes from "@/pages/Notes";
import TinderMode from "@/pages/TinderMode";
import Forecast from "@/pages/Forecast";
import AbsenceForecastPage from "@/pages/AbsenceForecast";
import Auth from "@/pages/Auth";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/auth" element={<Auth />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route
      path="/*"
      element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/forecast" element={<Forecast />} />
              <Route path="/absence" element={<AbsenceForecastPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/videocoaching" element={<Videocoaching />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/ai-consultant" element={<AIConsultant />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/tinder" element={<TinderMode />} />
              <Route path="/models" element={<Models />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      }
    />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <PlatformProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </PlatformProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
