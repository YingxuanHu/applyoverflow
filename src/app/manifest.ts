import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Apply Overflow",
    short_name: "Apply Overflow",
    description:
      "Find fresher, higher-quality jobs and keep every application step organized.",
    start_url: "/",
    display: "standalone",
    background_color: "#1f1f22",
    theme_color: "#1f1f22",
    icons: [
      {
        src: "/brand/applyoverflow-favicon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
