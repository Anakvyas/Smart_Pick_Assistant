const { validationResult } = require('express-validator');
const { signup, login, getCurrentUser } = require('../services/auth.service');
const { AppError } = require('../middleware/error-handler');
const { setAuthCookie, clearAuthCookie } = require('../utils/jwt');
const { findUserById } = require('../repositories/user.repository');
const { verifyToken } = require('../utils/jwt');

async function signupHandler(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const result = await signup({ name, email, password });

    const token = require('../utils/jwt').signToken({
      id: result.user.id,
      role: result.user.role,
    });

    setAuthCookie(res, token);

    return res.status(201).json({
      success: true,
      message: 'Picker account created successfully.',
      data: { user: result.user },
    });
  } catch (error) {
    return next(error);
  }
}

async function loginHandler(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await login({ email, password });

    setAuthCookie(res, result.token);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: { user: result.user },
    });
  } catch (error) {
    return next(error);
  }
}

async function meHandler(req, res, next) {
  try {
    const token = req.cookies?.[process.env.COOKIE_NAME || 'picker_session'];

    if (!token) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
    }

    try {
      const payload = verifyToken(token);
      const user = await getCurrentUser(payload.id);

      return res.status(200).json({
        success: true,
        data: { user },
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
        throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
}

async function logoutHandler(req, res) {
  clearAuthCookie(res);
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully.',
  });
}

module.exports = {
  signupHandler,
  loginHandler,
  meHandler,
  logoutHandler,
};
