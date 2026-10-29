@echo off
rem Double-click to start People at http://localhost:5173 (keep this window open while you use it).
cd /d "%~dp0"
start "" http://localhost:5173
npm.cmd run dev
