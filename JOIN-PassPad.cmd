@echo off
title PassPad - join
rem For friends: installs Tailscale if needed, checks the link and opens the game page.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\join.ps1" %*
