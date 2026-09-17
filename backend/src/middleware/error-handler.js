class AppError extends Error {
  constructor(statusCode, code, message, fields = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

function formatError(error) {
  const response = {
    success: false,
    error: {
      code: error.code || 'INTERNAL_SERVER_ERROR',
      message: error.message || 'Something went wrong.',
    },
  };

  if (error.fields && Object.keys(error.fields).length > 0) {
    response.error.fields = error.fields;
  }

  return response;
}

function notFoundHandler(req, res) {
  res.status(404).json(
    formatError(new AppError(404, 'NOT_FOUND', 'Route not found.')),
  );
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const response = formatError(
    err instanceof AppError
      ? err
      : new AppError(
          statusCode,
          'INTERNAL_SERVER_ERROR',
          'An unexpected server error occurred.',
        ),
  );

  if (statusCode >= 500) {
    console.error('Unhandled backend error:', err);
  }

  res.status(statusCode).json(response);
}

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler,
  formatError,
};
