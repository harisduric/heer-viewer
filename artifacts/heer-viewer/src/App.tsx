import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { registerNavigate, redirectToUnlock } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import ImportPage from "@/pages/import";
import ViewerPage from "@/pages/viewer";
import BibliothekPage from "@/pages/bibliothek";
import KoordinatenPage from "@/pages/koordinaten";
import UnlockPage from "@/pages/unlock";

// Install a global fetch interceptor once at module-load time.
// Any 401 from a protected API endpoint (i.e. not /api/auth/*) triggers a
// redirect to /unlock, covering mid-session expiry and PIN rotation.
const _origFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const res = await _origFetch(...args);
  if (res.status === 401) {
    const url =
      typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
    if (!url.includes("/api/auth/")) {
      redirectToUnlock();
    }
  }
  return res;
};

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "ok">("loading");
  const locationRef = useRef(location);

  // Register the Wouter navigate function globally so the fetch interceptor
  // (and redirectToUnlock) can use it outside of React.
  useEffect(() => {
    registerNavigate(navigate);
  }, [navigate]);

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => {
        if (res.ok) {
          setStatus("ok");
        } else {
          const saved = locationRef.current;
          if (saved && saved !== "/unlock") {
            sessionStorage.setItem("heer_redirect", saved);
          }
          navigate("/unlock");
        }
      })
      .catch(() => {
        navigate("/unlock");
      });
  }, [navigate]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F7F8F3]">
        <Loader2 className="w-8 h-8 animate-spin text-[#B8CC5A]" />
      </div>
    );
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/unlock" component={UnlockPage} />
      <Route>
        <AuthGuard>
          <Switch>
            <Route path="/" component={ImportPage} />
            <Route path="/viewer" component={ViewerPage} />
            <Route path="/bibliothek" component={BibliothekPage} />
            <Route path="/koordinaten" component={KoordinatenPage} />
            <Route component={NotFound} />
          </Switch>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
