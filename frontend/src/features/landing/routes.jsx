import LandingPage from './pages/LandingPage';
import ContactPageRoute from './pages/ContactPageRoute';
import BlogsPage from './pages/BlogsPage';
import FAQsPage from './pages/FAQsPage';
import TeamPage from './pages/TeamPage';
import CommunityPage from './pages/CommunityPage';
import HelpPage from './pages/HelpPage';
import ProductsPage from './pages/ProductsPage';
import ProductDetailPage from './pages/ProductDetailPage';
import AboutUsPage from './pages/AboutUsPage';
import AboutNexintelPage from './pages/AboutNexintelPage';
import ContentHubPage from './pages/ContentHubPage';
import ContentHubStoriesPage from './pages/ContentHubStoriesPage';
import ContentHubStoryPage from './pages/ContentHubStoryPage';
import MicroToolsPage from './pages/MicroToolsPage';
import ComparePage from './pages/ComparePage';

const bare = { hideHeaderAndFooter: true };

export default [
  { path: '/', element: <LandingPage />, publicLayout: bare },
  { path: '/contact', element: <ContactPageRoute />, publicLayout: bare },
  { path: '/blogs', element: <BlogsPage />, publicLayout: bare },
  { path: '/blogs/:slug', element: <BlogsPage />, publicLayout: bare },
  { path: '/faqs', element: <FAQsPage />, publicLayout: bare },
  { path: '/team', element: <TeamPage />, publicLayout: bare },
  { path: '/legal-tools', element: <MicroToolsPage />, publicLayout: bare },
  { path: '/compare/jurinex-vs-alternatives', element: <ComparePage />, publicLayout: bare },
  { path: '/legal-tools/:toolSlug', element: <MicroToolsPage />, publicLayout: bare },
  { path: '/content-hub', element: <ContentHubPage />, publicLayout: bare },
  { path: '/content-hub/stories', element: <ContentHubStoriesPage />, publicLayout: bare },
  { path: '/content-hub/stories/:storySlug', element: <ContentHubStoryPage />, publicLayout: bare },
  { path: '/content-hub/high-courts', element: <ContentHubPage section="high-courts" />, publicLayout: bare },
  { path: '/content-hub/high-courts/:courtSlug', element: <ContentHubPage section="high-courts" />, publicLayout: bare },
  { path: '/content-hub/supreme-court', element: <ContentHubPage section="supreme-court" />, publicLayout: bare },
  { path: '/community', element: <CommunityPage />, publicLayout: bare },
  { path: '/help', element: <HelpPage />, publicLayout: bare },
  { path: '/products', element: <ProductsPage />, publicLayout: bare },
  { path: '/products/:productId', element: <ProductDetailPage />, publicLayout: bare },
  { path: '/aboutus', element: <AboutUsPage />, publicLayout: { hideContactBar: true, hideFooter: true } },
  { path: '/about-nexintel', element: <AboutNexintelPage />, publicLayout: {} },
];
