import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/authApi';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const response = await authApi.me();
      setUser(response.data.user);
      setIsAuthenticated(true);
    } catch {
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const response = await authApi.me();
        if (!active) return;
        setUser(response.data.user);
        setIsAuthenticated(true);
      } catch {
        if (!active) return;
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const signup = async (formData) => {
    const response = await authApi.signup(formData);
    setUser(response.data.user);
    setIsAuthenticated(true);
    return response;
  };

  const login = async (credentials) => {
    const response = await authApi.login(credentials);
    setUser(response.data.user);
    setIsAuthenticated(true);
    return response;
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
    setIsAuthenticated(false);
  };

  const value = useMemo(() => ({
    user,
    isAuthenticated,
    isLoading,
    signup,
    login,
    logout,
    refreshUser,
  }), [user, isAuthenticated, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export default AuthContext;
