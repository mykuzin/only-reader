import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // The fox's ear tips sit just inside Android's 80% safe circle at this padding.
    maskable: { ...minimal2023Preset.maskable, padding: 0.1, resizeOptions: { background: '#f7f5f0' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#f7f5f0' } },
  },
  images: ['public/favicon.svg'],
})
