/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
