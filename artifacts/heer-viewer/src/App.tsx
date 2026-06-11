import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ImportPage from "@/pages/import";
import ViewerPage from "@/pages/viewer";
import BibliothekPage from "@/pages/bibliothek";
import KoordinatenPage from "@/pages/koordinaten";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={ImportPage} />
      <Route path="/viewer" component={ViewerPage} />
      <Route path="/bibliothek" component={BibliothekPage} />
      <Route path="/koordinaten" component={KoordinatenPage} />
      <Route component={NotFound} />
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
