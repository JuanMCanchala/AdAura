import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine keeps the population in module state; a double-invoked render in dev would
  // otherwise make it look like ticks ran twice.
  reactStrictMode: false,
};

export default nextConfig;
