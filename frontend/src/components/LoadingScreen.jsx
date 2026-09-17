function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="spinner" aria-hidden="true" />
        <p>Checking your session...</p>
      </div>
    </div>
  );
}

export default LoadingScreen;
