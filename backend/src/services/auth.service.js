const bcrypt = require('bcryptjs');
const { AppError } = require('../middleware/error-handler');
const { findUserByEmail, createUser, updateLastLogin, findUserById } = require('../repositories/user.repository');
const { signToken } = require('../utils/jwt');

async function signup({ name, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await findUserByEmail(normalizedEmail);

  if (existingUser) {
    throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

async function login({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(normalizedEmail);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (!user.is_active) {
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is inactive.');
  }

  await updateLastLogin(user.id);

  const token = signToken({ id: user.id, role: user.role });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

async function getCurrentUser(userId) {
  const user = await findUserById(userId);

  if (!user) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  if (!user.is_active) {
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is inactive.');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

module.exports = {
  signup,
  login,
  getCurrentUser,
};
