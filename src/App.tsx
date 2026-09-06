import { Suspense, lazy, useEffect } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { RequireCloudAuth } from './components/RequireCloudAuth';
import { RequireSharedListings } from './components/RequireSubscriptionFeature';
import { RequireWorkspaceSetup } from './components/RequireWorkspaceSetup';
import { SubscriptionEnforcement } from './components/SubscriptionEnforcement';
import { InteractionShell } from './components/InteractionSystem';
import { OwnerTestModeBar } from './components/OwnerTestModeBar';
import { Toaster } from './components/ui/sonner';
import { billingPath } from './lib/billingRoutes';
import { buyerFollowUpPath } from './lib/buyerRoutes';
import { appBasePath, passwordResetPath, usesHashRouting } from './lib/routeCanon';
import { trackRuntimeEvent } from './lib/runtimeEvents';
import { tabOpenedRecoveryCallback } from '@/lib/authCallbackArrival';
import { hasValidatedPasswordRecovery, useCloudStore } from './store/useCloudStore';
import './routes/operationsHierarchy.css';
import './routes/interactionSystem.css';
import './routes/xbarCommandSystem.css';
import './routes/metalBrandSystem.css';
import './routes/commandCenterLocal.css';
import './routes/premiumOperatingSystem.css';
import './routes/premiumSaasExperience.css';
import './styles/xbarSaas.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const GettingStarted = lazy(() => import('./routes/GettingStarted'));
const ResetPassword = lazy(() => import('./routes/ResetPassword'));
const BuyerDealRoom = lazy(() => import('./routes/BuyerDealRoom'));
const SalePacketStudio = lazy(() => import('./routes/SalePacketStudio'));
const Reports = lazy(() => import('./routes/Reports'));
const Financials = lazy(() => import('./routes/Financials'));
const TodayWork = lazy(() => import('./routes/TodayWork'));
const HerdGroups = lazy(() => import('./routes/HerdGroups'));
const Pastures = lazy(() => import('./routes/Pastures'));
const FeedInventory = lazy(() => import('./routes/FeedInventory'));
const AnimalProfile = lazy(() => import('./routes/AnimalProfile'));
const HealthCare = lazy(() => import('./routes/HealthCare'));
const OwnershipChain = lazy(() => import('./routes/OwnershipChain'));
const EquipmentPage = lazy(() => import('./routes/Equipment'));
const BreedingFoaling = lazy(() => import('./routes/BreedingFoaling'));
const Breeding = lazy(() => import('./routes/Breeding'));
const BuyerProfile = lazy(() => import('./routes/BuyerProfile'));
const VerifyPacket = lazy(() => import('./routes/VerifyPacket'));
const Documents = lazy(() => import('./routes/Documents'));
const Expenses = lazy(() => import('./routes/Expenses'));
const Horses = lazy(() => import('./routes/Horses'));
const Login = lazy(() => import('./routes/Login'));
const MainLayout = lazy(() => import('./routes/layouts/MainLayout'));
const Medical = lazy(() => import('./routes/Medical'));
const NotFound = lazy(() => import('./routes/NotFound'));
const Ownership = lazy(() => import('./routes/Ownership'));
const RanchAssets = lazy(() => import('./routes/RanchAssets'));
const Reminders = lazy(() => import('./routes/Reminders'));
const Sales = lazy(() => import('./routes/Sales'));
const Settings = lazy(() => import('./routes/Settings'));
const SetupWorkspace = lazy(() => import('./routes/SetupWorkspace'));
const SharedAccess = lazy(() => import('./routes/SharedAccess'));
const Subscriptions = lazy(() => import('./routes/Subscriptions'));
const Weather = lazy(() => import('./routes/Weather'));

// One unique label per route: no two routes may share a user-facing name, so
// navigation, page titles, and the command palette always agree on where a
// feature lives (routeCanon.ts documents the canonical route per area).
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/getting-started': 'Getting started',
  '/today': 'Care Tasks',
  '/herd-groups': 'Herd Groups',
  '/pastures': 'Pastures',
  '/feed': 'Feed & Supplies',
  '/health-care': 'Care Board',
  '/ownership-chain': 'Ownership',
  '/equipment': 'Equipment',
  '/breeding-foaling': 'Breeding',
  '/billing': 'Billing',
  '/buyers': 'Buyer Follow-up',
  '/sale-packets': 'Sale Packets',
  '/reports': 'Reports',
  '/financials': 'Money',
  '/assets': 'Ranch Assets',
  '/breeding': 'Breeding Records',
  '/documents': 'Documents',
  '/expenses': 'Expenses',
  '/horses': 'Horses',
  '/login': 'Login',
  '/medical': 'Health Records',
  '/ownership': 'Ownership Records',
  '/reminders': 'Reminders',
  '/sales': 'Sales',
  '/settings': 'Settings',
  '/setup': 'Setup',
  '/shared-access': 'Listings',
  '/weather': 'Weather',
};

function LegacyHorseRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/horses/${id}` : '/horses'} replace />;
}

function routeTitle(path: string) {
  if (path.startsWith('/profiles/')) return 'XBAR | Listings';
  if (path.startsWith('/horses/')) return 'XBAR | Horse';
  if (path.startsWith('/buyers/')) return 'XBAR | Buyer Follow-up';
  return `XBAR | ${ROUTE_LABELS[path] ?? 'Ranch'}`;
}

// The SPA only serves the authenticated application (plus the noindex login
// and buyer-share views); all indexable pages are prerendered static HTML on
// the marketing site, so the app shell just keeps the tab title accurate.
function applyRouteMeta(path: string) {
  if (typeof document === 'undefined') return;
  document.title = path === '/login' ? 'Sign in | XBAR' : routeTitle(path);
}

// Operator comp access is no longer a bridge that writes to the store.
//
// The previous version reacted to a comped email by calling
// `applySubscriptionTier('Enterprise', { billingState: 'Manual Billing' })`,
// which overwrites the workspace's real subscription — the same field a genuine
// plan lives in, persisted and synced — and "self-healed" by rewriting it again
// after every cloud sync that restored the truth. There was no way back to the
// real plan because the real plan had been overwritten.
//
// Tier preview is now a read-time overlay (src/hooks/useOwnerPreview.ts) that
// never writes to the subscription, so returning to the real entitlement is
// simply switching the overlay off. See OwnerTestModeBar for the control.

function RouteTelemetry() {
  const location = useLocation();
  const workspaceId = useCloudStore((state) => state.workspaceId);

  useEffect(() => {
    void trackRuntimeEvent({
      workspaceId: workspaceId || undefined,
      eventName: 'navigation.page_view',
      severity: 'info',
      payload: { pathname: location.pathname, search: location.search },
    });
  }, [location.pathname, location.search, workspaceId]);

  useEffect(() => {
    applyRouteMeta(location.pathname);
  }, [location.pathname]);

  return null;
}

function FollowUpsRedirect() {
  const location = useLocation();
  const leadId = new URLSearchParams(location.search).get('lead');
  return <Navigate to={buyerFollowUpPath(leadId ?? undefined)} replace />;
}

/*
 * Carries a password-recovery arrival to the reset screen.
 *
 * The recovery link cannot always name that screen itself: on the hash router
 * the route and Supabase's implicit-flow session would have to share one URL
 * fragment, so the email only loads the shell. This is also the more robust
 * place for the decision -- it depends on the auth event rather than on a URL
 * composed days earlier by a different build, which is exactly what went wrong
 * twice in getting here.
 */
function PasswordRecoveryRedirect() {
  const pending = useCloudStore(hasValidatedPasswordRecovery);
  const location = useLocation();
  const navigate = useNavigate();

  /*
   * Only the tab that opened the link. auth-js broadcasts PASSWORD_RECOVERY to
   * every open tab -- which is right, and is how a spent grant gets released
   * everywhere -- but it is not a reason to yank every other tab to this
   * screen, unmounting whatever the customer had in progress there.
   *
   * Routing only. The grant still comes from Supabase's validated event, so a
   * forged fragment moves someone to a screen that then refuses them.
   */
  const openedTheLink = tabOpenedRecoveryCallback();

  useEffect(() => {
    if (pending && openedTheLink && location.pathname !== passwordResetPath) {
      navigate(passwordResetPath, { replace: true });
    }
  }, [pending, openedTheLink, location.pathname, navigate]);

  return null;
}

export default function App() {
  const hashRouting = usesHashRouting();
  const Router = hashRouting ? HashRouter : BrowserRouter;

  return (
    <Router {...(hashRouting ? {} : { basename: appBasePath })}>
      <ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
        <InteractionShell />
        <SubscriptionEnforcement />
        <RouteTelemetry />
        <PasswordRecoveryRedirect />
        {/* Renders nothing unless the viewer is an authorized owner. */}
        <OwnerTestModeBar />
        <Suspense
          fallback={
            <div className="app-loading-shell" role="status" aria-live="polite">
              <span className="app-loading-shell__spinner" aria-hidden="true" />
              Loading XBAR…
            </div>
          }
        >
          <Routes>
            <Route path="/profiles/:id" element={<BuyerProfile />} />
            <Route path="/verify" element={<VerifyPacket />} />
            <Route path="/verify/:packetId" element={<VerifyPacket />} />
            <Route path="/login" element={<Login />} />
            <Route path={passwordResetPath} element={<ResetPassword />} />
            <Route path="/subscribe" element={<Navigate to={billingPath} replace />} />
            <Route
              path="/setup"
              element={
                <RequireCloudAuth>
                  <SetupWorkspace />
                </RequireCloudAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireCloudAuth>
                  <MainLayout />
                </RequireCloudAuth>
              }
            >
              <Route path="plans" element={<Navigate to={billingPath} replace />} />
              <Route path="billing" element={<Subscriptions />} />
              <Route path="subscriptions" element={<Navigate to={billingPath} replace />} />
              <Route
                element={
                  <RequireWorkspaceSetup>
                    <Outlet />
                  </RequireWorkspaceSetup>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="getting-started" element={<GettingStarted />} />
                <Route path="today" element={<TodayWork />} />
                <Route path="herd-groups" element={<HerdGroups />} />
                <Route path="pastures" element={<Pastures />} />
                <Route path="feed" element={<FeedInventory />} />
                <Route path="documents-vault" element={<Navigate to="/documents" replace />} />
                <Route path="sales-pipeline" element={<Navigate to="/sales" replace />} />
                <Route path="buyer-deal-room" element={<Navigate to="/buyers" replace />} />
                <Route path="buyer-follow-up" element={<Navigate to="/buyers" replace />} />
                <Route path="buyers" element={<BuyerDealRoom />} />
                <Route path="buyers/:leadId" element={<BuyerDealRoom />} />
                <Route path="sale-packets" element={<SalePacketStudio />} />
                <Route path="sale-packet-studio" element={<Navigate to="/sale-packets" replace />} />
                <Route path="reports" element={<Reports />} />
                <Route path="financials" element={<Financials />} />
                <Route path="animals" element={<Navigate to="/horses" replace />} />
                <Route path="animals/:id" element={<LegacyHorseRedirect />} />
                <Route path="health-care" element={<HealthCare />} />
                <Route path="ownership-chain" element={<OwnershipChain />} />
                <Route path="equipment" element={<EquipmentPage />} />
                <Route path="breeding-foaling" element={<BreedingFoaling />} />
                <Route path="horses" element={<Horses />} />
                <Route path="horses/:id" element={<AnimalProfile />} />
                <Route path="documents" element={<Documents />} />
                <Route path="document-library" element={<Navigate to="/documents" replace />} />
                <Route path="weather" element={<Weather />} />
                <Route path="ownership" element={<Ownership />} />
                <Route path="medical" element={<Medical />} />
                <Route path="breeding" element={<Breeding />} />
                <Route path="sales" element={<Sales />} />
                <Route path="follow-ups" element={<FollowUpsRedirect />} />
                <Route path="expenses" element={<Expenses />} />
                <Route path="reminders" element={<Reminders />} />
                <Route path="assets" element={<RanchAssets />} />
                <Route path="assets-equipment" element={<Navigate to="/assets" replace />} />
                <Route
                  path="shared-access"
                  element={
                    <RequireSharedListings>
                      <SharedAccess />
                    </RequireSharedListings>
                  }
                />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Router>
  );
}
