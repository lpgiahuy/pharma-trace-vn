import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons', 'lucide-react', 'recharts'],
  },
};

export default nextConfig;
