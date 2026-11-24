@echo off
title PassPad
rem Double-click to share your PS5. Add "doctor", "setup", "update" or "autostart" for the extras.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-host.ps1" %*
