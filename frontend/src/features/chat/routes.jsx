import ChatModelPage from './pages/ChatModelPage';
import ChatHistoryPage from './pages/ChatHistoryPage';

export default [
  { path: '/chatmodel', element: <ChatModelPage />, auth: true },
  { path: '/chatmodel/session/:sessionId', element: <ChatModelPage />, auth: true },
  { path: '/chatmodel/:fileId/:sessionId', element: <ChatModelPage />, auth: true },
  { path: '/chats', element: <ChatHistoryPage />, auth: true },
];
