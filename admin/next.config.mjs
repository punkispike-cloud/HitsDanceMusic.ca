/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image standalone pour Docker/Railway (n'embarque que le nécessaire).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
