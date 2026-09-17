const express = require('express');
const { body } = require('express-validator');
const { signupHandler, loginHandler, meHandler, logoutHandler } = require('../controllers/auth.controller');
const { validateRequest } = require('../middleware/validate');

const router = express.Router();

const signupValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters long.'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Please enter a valid email address.')
    .normalizeEmail({ gmail_remove_dots: false }),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long.'),
  body('confirmPassword')
    .exists()
    .withMessage('Please confirm your password.')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.'),
  validateRequest,
];

const loginValidation = [
  body('email').trim().isEmail().withMessage('Please enter a valid email address.').normalizeEmail({ gmail_remove_dots: false }),
  body('password').notEmpty().withMessage('Password is required.'),
  validateRequest,
];

router.post('/signup', signupValidation, signupHandler);
router.post('/login', loginValidation, loginHandler);
router.get('/me', meHandler);
router.post('/logout', logoutHandler);

module.exports = router;
