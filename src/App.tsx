import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlatformProvider } from "@/contexts/PlatformContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Layout } from "@/components/Layout";
import { LuxuryCursor } from "@/components/LuxuryCursor";
import Dashboard from "@/pages/Dashboard";
import UploadPage from "@/pages/Upload";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Models from "@/pages/Models";
import SettingsPage from "@/pages/SettingsPage";
import AIConsultant from "@/pages/AIConsultant";
import Roadmap from "@/pages/Roadmap";

import Leaderboard from "@/pages/Leaderboard";
import Notes from "@/pages/Notes";
import TinderMode from "@/pages/TinderMode";

import Anomalies from "@/pages/Anomalies";
import Goals from "@/pages/Goals";
import Auth from "@/pages/Auth";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";
import Today from "@/pages/Today";
import LiveTracking from "@/pages/LiveTracking";
import Push from "@/pages/Push";
import Messages from "@/pages/Messages";
import ContentScout from "@/pages/ContentScout";
import Coaching from "@/pages/Coaching";
import CoachingView from "@/pages/CoachingView";
import OAuthConsent from "@/pages/OAuthConsent";

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
    <Route path="/c/:token" element={<CoachingView />} />
    <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
    <Route
      path="/*"
      element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/live" element={<LiveTracking />} />
              <Route path="/push" element={<Push />} />
              <Route path="/nachrichten" element={<Messages />} />
              <Route path="/today" element={<ErrorBoundary><Today /></ErrorBoundary>} />
              <Route path="/auffaelligkeiten" element={<Anomalies />} />
              <Route path="/ziele" element={<Goals />} />
              <Route path="/monatsziele" element={<Navigate to="/ziele" replace />} />
              <Route path="/upload" element={<UploadPage />} />

              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/fahrplan" element={<ErrorBoundary><Roadmap /></ErrorBoundary>} />
              <Route path="/ai-consultant" element={<AIConsultant />} />
              <Route path="/ai-consultant/:threadId" element={<AIConsultant />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/tinder" element={<TinderMode />} />
              <Route path="/models" element={<Models />} />
              <Route path="/content-scout" element={<ContentScout />} />
              <Route path="/coaching" element={<Coaching />} />
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
      <LuxuryCursor />
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
