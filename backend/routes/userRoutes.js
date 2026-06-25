import express from "express";
import {
  googleAuth,
  updateProfile,
  getUsers,
  logoutUser,
  getUserProfile,
  loginUser,
  registerUser
} from "../controllers/userController.js";
import { protect, adminProtect } from "../middleware/authMiddleware.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Configure multer for profile picture uploads
const profileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "The_Brave_Profile_Pictures",
    allowed_formats: ["jpg", "png", "jpeg", "webp", "avif"],
    transformation: [{ width: 500, height: 500, crop: "limit" }],
  },
});

const uploadProfilePicture = multer({ storage: profileStorage });

// Public routes
router.post("/google", googleAuth);
router.post("/login", loginUser);
router.post("/register", registerUser);

// Protected routes
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, uploadProfilePicture.single("profilePicture"), updateProfile);
router.post("/logout", protect, logoutUser);

// Admin routes
router.get("/", adminProtect, getUsers);

export default router;