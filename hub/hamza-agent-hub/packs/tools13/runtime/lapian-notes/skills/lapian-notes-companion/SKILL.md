---
name: lapian-notes-companion
description: A tested CPU-only video frame pack builder, for the free MIT-licensed Lapian Notes workflow. Can sample a local film and export frame timestamps plus prompts, without a remote AI model.
---
# Lapian Notes companion (unofficial)
- Verified upstream: https://github.com/bkingfilm/lapian-notes (MIT), demo https://bkingfilm.github.io/lapian-notes/
- Official app already extracts frames, builds study timelines, exports analysis prompts and imports AI JSON in-browser. **Use upstream first** when user can supply video via browser. No need to duplicate upstream app.
- This companion adds a tested local ZIP preparation tool for environments where ChatGPT has file tools and ffmpeg. It is NOT the official Lapian app and DOES NOT do AI visual analysis itself. One sample every configured interval, hard cap: honest non-exhaustive sampling.
- For uploaded/local user video, run `python3 scripts/film_pack.py /path/to/video.mp4 --out /mnt/data/lapian-analysis-pack.zip --interval 2 --max-frames 36`. Extracted frames/metadata stay local; review before sharing with an AI model. Do not upload copyrighted video to a third-party service without user's authority.
- Use real host file paths; never claim plugin can reach phone files automatically. Use available file/container tools. Do not run GPUs or spend money. Always check for existing relevant tools/plugins first.
- For full Lapian AI analysis with visual segmentation, use the official app or explicitly configured vision model and report the external processing; plugin only builds an input package.
- Before marking this **fully connected to Hamza Hub**, verify `run_command` can run `ffmpeg` and our script there on a sample video. An uploaded private ChatGPT skill alone is not proof of active remote Hub connection.
