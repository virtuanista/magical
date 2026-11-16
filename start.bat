@echo off
cd /d %~dp0
start "" http://localhost:5180/
npx vite --port 5180
