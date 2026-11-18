/** @type {import('next').NextConfig} */
const defaultFastApiUrl = process.env.VERCEL
  ? "https://ai-quotation-api.onrender.com"
  : "http://127.0.0.1:8000";
const fastApiInternalUrl = (process.env.FASTAPI_INTERNAL_URL || defaultFastApiUrl).replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  async rewrites() {
    return [
      { source: "/backend-api/:path*", destination: `${fastApiInternalUrl}/:path*` }
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;
