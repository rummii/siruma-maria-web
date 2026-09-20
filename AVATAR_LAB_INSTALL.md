# Maria real-time facial prototype

This package adds an isolated `/avatar-lab` route. It does not replace the main Maria page.

From the root of the `rummii/siruma-maria-web` repository:

```bash
tar -xzf ~/maria-avatar-lab.tar.gz
pnpm add three
pnpm add -D @types/three
pnpm build
```

The page reuses the existing `/api/tts` endpoint. The original FBX is loaded in the browser and its named facial blendshapes are driven directly from the generated audio.

Asset attribution is included at `public/avatar-lab/lisa/ATTRIBUTION.txt` and is also displayed on the laboratory page.
