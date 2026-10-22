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

const bare = { hideHeaderAndFooter: true };

export default [
  { path: '/', element: <LandingPage />, publicLayout: bare },
  { path: '/contact', element: <ContactPageRoute />, publicLayout: bare },
  { path: '/blogs', element: <BlogsPage />, publicLayout: bare },
  { path: '/faqs', element: <FAQsPage />, publicLayout: bare },
  { path: '/team', element: <TeamPage />, publicLayout: bare },
  { path: '/community', element: <CommunityPage />, publicLayout: bare },
  { path: '/help', element: <HelpPage />, publicLayout: bare },
  { path: '/products', element: <ProductsPage />, publicLayout: bare },
  { path: '/products/:productId', element: <ProductDetailPage />, publicLayout: bare },
  { path: '/aboutus', element: <AboutUsPage />, publicLayout: { hideContactBar: true, hideFooter: true } },
  { path: '/about-nexintel', element: <AboutNexintelPage />, publicLayout: {} },
];
