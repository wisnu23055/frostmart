export const setCookies = (res, { accessToken, refreshToken }) => {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie("access_token", accessToken, {
    httpOnly: true, // kalau true tidak diakases oleh frontend atau JS
    secure: isProduction, // hanya bisa dipakai oleh https bukan http
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 60 * 60 * 1000,
  });

  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export const clearCookies = (res) => {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieOptions = {
    path: "/",
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
  };

  res.clearCookie("access_token", cookieOptions);
  res.clearCookie("refresh_token", cookieOptions);
};

