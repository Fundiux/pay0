import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PAY0",
    short_name: "PAY0",
    description: "Plataforma de operaciones financieras PAY0.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    lang: "es-MX",
  };
}
