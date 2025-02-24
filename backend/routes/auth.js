import express from 'express';
import CryptoJS from 'crypto-js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import sgMail from '@sendgrid/mail'; // Import SendGrid's mail module
import Otp from '../models/Otp.js';
import { config } from 'dotenv';

// Initialize environment variables
config();

const router = express.Router();

// Set your SendGrid API Key here
sgMail.setApiKey(process.env.SENDGRID_API_KEY); // Use the SendGrid API key from the .env file

// Function to generate OTP
const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Function to send OTP using SendGrid
const sendOtp = async (email, otp) => {
  const msg = {
    to: email, // User's email address
    from: process.env.EMAIL_USER, // Your verified SendGrid email address
    subject: 'Password Reset OTP',
    text: `Your OTP for password reset is: ${otp}. It is valid for 10 minutes.`,
  };

  try {
    await sgMail.send(msg); // Send email using SendGrid
    console.log('OTP sent successfully');
  } catch (error) {
    // Improved error handling
    console.error('Error sending OTP:', error.response ? error.response.body : error);
    throw new Error('Failed to send OTP.');
  }
};

// Register new user
router.post('/register', async (req, res) => {
  const { username, email, password, isAdmin } = req.body;

  if (!username || !email || !password) {
    return res
      .status(400)
      .json('All fields (username, email, password) are required.');
  }

  const newUser = new User({
    username,
    email,
    password: CryptoJS.AES.encrypt(password, process.env.PASS_SEC).toString(),
    isAdmin: username === 'admin' ? true : isAdmin || false,
  });

  try {
    const savedUser = await newUser.save();
    res.status(201).json(savedUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Something went wrong while registering the user.',
      error: err.message,
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json('Both username and password are required.');
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json('Wrong username or password.');
    }

    const hashedPassword = CryptoJS.AES.decrypt(
      user.password,
      process.env.PASS_SEC
    );
    const originalPassword = hashedPassword.toString(CryptoJS.enc.Utf8);

    if (originalPassword !== password) {
      return res.status(401).json('Incorrect password.');
    }

    const accessToken = jwt.sign(
      {
        id: user._id,
        isAdmin: user.isAdmin,
      },
      process.env.JWT_SEC,
      { expiresIn: '3d' }
    );

    const { password: userPassword, ...others } = user._doc;
    res.status(200).json({ ...others, accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Something went wrong while logging in.',
      error: err.message,
    });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json('Email is required.');
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json('User not found.');
    }

    const otp = generateOtp();

    let otpRecord = await Otp.findOne({ email });

    if (otpRecord) {
      otpRecord.otp = otp;
      otpRecord.createdAt = new Date();
      await otpRecord.save();
    } else {
      otpRecord = new Otp({
        email,
        otp,
      });
      await otpRecord.save();
    }

    // Send OTP via SendGrid
    await sendOtp(email, otp);

    res.status(200).json('OTP sent to your email.');
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Error requesting password reset.',
      error: err.message,
    });
  }
});

// Verify OTP for password reset
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json('Email and OTP are required.');
  }

  try {
    const otpRecord = await Otp.findOne({ email }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json('OTP not found or expired.');
    }

    const isExpired =
      new Date() - new Date(otpRecord.createdAt) > 10 * 60 * 1000; // 10 minutes expiration

    if (isExpired) {
      return res.status(400).json('OTP expired. Please request a new one.');
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json('Invalid OTP.');
    }

    res.status(200).json('OTP verified. You can now reset your password.');
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Error verifying OTP.',
      error: err.message,
    });
  }
});

// Reset user password
router.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res.status(400).json('Email and new password are required.');
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json('User not found.');
    }

    const encryptedPassword = CryptoJS.AES.encrypt(
      newPassword,
      process.env.PASS_SEC
    ).toString();

    user.password = encryptedPassword;
    await user.save();

    // Delete OTP record after password reset
    await Otp.deleteOne({ email });

    res.status(200).json('Password has been successfully reset.');
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Error resetting the password.',
      error: err.message,
    });
  }
});

export default router;
