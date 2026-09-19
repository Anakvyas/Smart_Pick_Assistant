import { Navigate, useLocation } from 'react-router-dom';

function ProtectedRoute({ isAuthenticated, isLoading, children }) {
  const location = useLocation();

  if (isLoading) {
    return <div className="loading-screen"><div className="loading-card"><div className="spinner" aria-hidden="true" /><p>Loading...</p></div></div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default ProtectedRoute;
