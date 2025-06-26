import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// GET /api/local-loras
// Returns all *.safetensors files found inside the Headless-Wan2GP/loras directory (or directory provided via WAN_LORA_DIR env var)
router.get('/', (_req, res) => {
  try {
    const wanLoraDir = process.env.WAN_LORA_DIR || path.join(process.cwd(), 'Headless-Wan2GP', 'loras');

    if (!fs.existsSync(wanLoraDir)) {
      res.status(404).json({ message: `LoRA directory not found: ${wanLoraDir}` });
      return;
    }

    const files = fs.readdirSync(wanLoraDir);
    const loraFiles = files.filter((f) => f.toLowerCase().endsWith('.safetensors'));

    // Return absolute file paths so the headless worker can consume them directly
    const absolutePaths = loraFiles.map((f) => path.join(wanLoraDir, f));

    res.json({ files: absolutePaths });
  } catch (err: any) {
    console.error('[API /local-loras] Error reading local LoRA directory', err);
    res.status(500).json({ message: 'Internal server error', error: err?.message ?? 'unknown' });
  }
});

export default router; 