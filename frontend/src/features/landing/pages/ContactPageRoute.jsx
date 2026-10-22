import { useNavigate } from 'react-router-dom';
import ContactPage from './ContactPage';

export default function ContactPageRoute() {
  const navigate = useNavigate();

  return (
    <ContactPage
      onNavigateLogin={() => navigate('/login')}
      onSectionNav={(sectionId) =>
        navigate('/', { state: { scrollTo: sectionId } })
      }
    />
  );
}
