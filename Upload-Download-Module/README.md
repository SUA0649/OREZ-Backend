# File Uploader React (Temporary Upload & Download)

This is a minimal Vite + React app that lets you temporarily upload files in the browser (drag & drop or file picker), then download or remove them. Files are stored in-memory in the browser and are not sent to any server.

## Files created
- `package.json` — project metadata and scripts
- `vite.config.js` — Vite + React plugin
- `index.html` — app entry
- `src/main.jsx` — React entry
- `src/App.jsx` — main app
- `src/components/UploadBox.jsx` — drag/drop + file input
- `src/components/FileList.jsx` — list, download, remove
- `src/index.css` — basic styles

## Run (PowerShell on Windows)
Open PowerShell in this folder (`Upload-Download-Module`) and run:

```powershell
npm install
npm run dev
```

After install, open the dev URL printed by Vite (usually http://localhost:5173) in your browser.

## Notes
- This is a client-only demo. Files are not uploaded to a server.
- If you want a backend to persist files, I can add an Express endpoint and wire uploads. Ask if you'd like that.
