import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The test-call route reads the sample clip from disk for transcription tests.
  outputFileTracingIncludes: {
    "/api/test-call": ["./public/sample-audio.wav"],
  },
};

export default nextConfig;
