@echo off
cd /d "%~dp0client"
npx vite --port 5311 --strictPort
