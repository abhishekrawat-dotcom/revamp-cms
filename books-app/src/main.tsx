// The Books editor (BOOKSTUDIO) inside ETB2B EventSphere: books.html loads this bundle (books/app.js) and its styles
// (books/app.css, built by Tailwind from index.css — not imported here) after auth.js has signed the person in.
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
