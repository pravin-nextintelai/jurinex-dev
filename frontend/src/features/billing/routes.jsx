import PricingPage from './pages/PricingPage';
import SubscriptionPlanPage from './pages/SubscriptionPlanPage';
import BillingAndUsagePage from './pages/BillingAndUsagePage';

export default [
  { path: '/pricing', element: <PricingPage />, publicLayout: { hideContactBar: true, hideFooter: true } },
  { path: '/subscription-plans', element: <SubscriptionPlanPage />, auth: true },
  { path: '/billing-usage', element: <BillingAndUsagePage />, auth: true },
];
