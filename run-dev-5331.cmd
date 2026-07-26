@echo off
cd /d "%~dp0client"
npx vite --port 5331 --strictPort
