import * as service from "./auth.service.js";
import { setCookies, clearCookies } from "../../utils/cookie.js";
import { signupSchema, signinSchema, updateMeSchema } from "./auth.validation.js";

export const signup = async (req, res) => {
  try {
    const data = signupSchema.parse(req.body);

    const result = await service.signup(data);

    setCookies(res, result);

    res.status(201).json({ user: result.user });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const signin = async (req, res) => {
  try {
    const data = signinSchema.parse(req.body);

    const result = await service.signin(data);

    setCookies(res, result);

    res.json({ user: result.user });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// REFRESH
export const refresh = async (req, res) => {
  try {
    const token = req.cookies.refresh_token || req.headers["x-refresh-token"];

    const result = await service.refreshToken(token);

    setCookies(res, result);

    res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  } catch (err) {
    res.status(403).json({ message: err.message });
  }
};

// ME
export const me = async (req, res) => {
  try {
    const id = req.user.id; // 🔥 ambil dari JWT middleware

    const user = await service.getUser(id);

    res.json(user); // 🔥 return data dari DB
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// UPDATE ME
export const updateMe = async (req, res) => {
  try {
    const data = updateMeSchema.parse(req.body);

    const userId = req.user.id;

    const updatedUser = await service.updateMe(userId, data);

    res.json(updatedUser);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// REMOVE SESSION (LOGOUT)
export const removeSession = async (req, res) => {
  try {
    await service.removeSession();

    // clear cookies
    clearCookies(res);

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const deleteMe = async (req, res) => {
  try {
    const userId = req.user.id;
    await service.deleteMe(userId);

    // clear cookies upon account deletion
    clearCookies(res);

    res.json({ message: "Akun berhasil dihapus" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
