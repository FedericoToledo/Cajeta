import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Base relativa: funciona servida en la raíz o en un subpath de la web madre (Vexion.ar).
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
