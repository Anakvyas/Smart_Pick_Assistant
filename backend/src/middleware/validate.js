const { validationResult } = require('express-validator');
const { AppError } = require('./error-handler');

function validateRequest(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const fields = {};

    errors.array().forEach((error) => {
      const field = error.path || 'form';
      fields[field] = error.msg;
    });

    return next(
      new AppError(400, 'VALIDATION_ERROR', 'Please check the form and try again.', fields),
    );
  }

  return next();
}

module.exports = { validateRequest };
